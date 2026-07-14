import { occurrenceDate } from '$lib/plans/cadence';
import { NotFoundError, ValidationError } from '../accounts/errors';
import type { DbClient, DbRow, DbStatement } from '../db-client';
import type {
	RecurringConfidenceFactors,
	ConfirmRecurringSuggestionInput,
	RecurringDirection,
	RecurringEvidence,
	RecurringGroup,
	UpdateRecurringGroupInput
} from './types';
import type { Plan } from '../plans/types';
import { getPlan } from '../plans/repository';
import { insertLiabilityBaseline } from '../liabilities/baselines';

const detectorVersion = 3;
const minimumConfidence = 70;
const amountToleranceCents = 100;
const amountToleranceRatio = 0.05;
const cadenceWindows: Array<{
	cadence: RecurringGroup['cadence'];
	targetDays: number;
	minDays: number;
	maxDays: number;
	maxStaleDays: number;
}> = [
	{ cadence: 'daily', targetDays: 1, minDays: 1, maxDays: 1, maxStaleDays: 14 },
	{ cadence: 'weekly', targetDays: 7, minDays: 6, maxDays: 8, maxStaleDays: 28 },
	{ cadence: 'biweekly', targetDays: 14, minDays: 12, maxDays: 16, maxStaleDays: 45 },
	{ cadence: 'monthly', targetDays: 30, minDays: 26, maxDays: 35, maxStaleDays: 31 },
	{ cadence: 'quarterly', targetDays: 91, minDays: 80, maxDays: 100, maxStaleDays: 210 },
	{ cadence: 'yearly', targetDays: 365, minDays: 350, maxDays: 380, maxStaleDays: 550 }
];

export async function listRecurringGroups(db: DbClient): Promise<RecurringGroup[]> {
	const { results } = await db
		.prepare(`${recurringGroupSelect()} ORDER BY rg.status ASC, rg.next_date ASC, rg.payee ASC`)
		.all<RecurringGroupRow>();
	const evidence = await listRecurringEvidence(db);
	return results.map((row) => mapRecurringGroup(row, evidence.get(row.id) ?? []));
}

export async function confirmRecurringSuggestion(
	db: DbClient,
	input: ConfirmRecurringSuggestionInput
): Promise<Plan> {
	const group = await getRecurringGroup(db, input.id);
	if (!group) throw new NotFoundError('Recurring group not found');
	if (group.status !== 'suggested')
		throw new ValidationError('Recurring suggestion has already been handled');
	const direction = input.direction ?? group.direction;
	const categoryId = input.liability
		? 'cat-installment-plan'
		: input.categoryId === undefined
			? group.categoryId
			: input.categoryId;
	const accountId = input.accountId === undefined ? group.accountId : input.accountId;
	const cadence = input.cadence ?? group.cadence;
	const amount = input.expectedAmountCents ?? group.expectedAmountCents;
	const nextDate = input.nextDate === undefined ? group.nextDate : input.nextDate;
	const endDate = input.endDate === undefined ? group.endDate : input.endDate;
	if (!direction || !categoryId || !nextDate)
		throw new ValidationError(
			'Confirmed recurring groups require direction, category, and next date'
		);
	if (input.liability && direction !== 'outgoing')
		throw new ValidationError('Liabilities can only be created from outgoing suggestions');
	if (endDate && endDate < nextDate) throw new ValidationError('endDate cannot be before nextDate');
	await assertOptionalLinks(db, accountId, categoryId);
	const planId = crypto.randomUUID();
	const liabilityId = input.liability ? crypto.randomUUID() : null;
	const planDirection = direction === 'incoming' ? 'income' : 'expense';
	const statements: DbStatement[] = [];
	if (input.liability && liabilityId) {
		statements.push(
			db
				.prepare(
					`INSERT INTO marked_liabilities (
				id, account_id, name, amount_cents, as_of_date, annual_interest_rate_bps, status
			) VALUES (?, ?, ?, ?, ?, ?, 'active')`
				)
				.bind(
					liabilityId,
					accountId,
					input.liability.name,
					input.liability.amountCents,
					input.liability.asOfDate,
					input.liability.annualInterestRateBps
				)
		);
		statements.push(
			await insertLiabilityBaseline(
				db,
				liabilityId,
				input.liability.amountCents,
				input.liability.asOfDate
			)
		);
	}
	statements.push(
		db
			.prepare(
				`INSERT INTO plans (id, account_id, category_id, label, counterparty, direction, cadence, amount_cents, next_date, end_date, status, source, source_recurring_group_id, liability_id, schedule_anchor_date, schedule_occurrence_index, manual_status)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 'recurring_suggestion', ?, ?, ?, 0, 'active')`
			)
			.bind(
				planId,
				accountId,
				categoryId,
				input.label === undefined ? group.label : input.label,
				input.payee ?? group.payee,
				planDirection,
				cadence,
				amount,
				nextDate,
				endDate,
				group.id,
				liabilityId,
				nextDate
			),
		db
			.prepare(
				"UPDATE recurring_groups SET status = 'confirmed', source = 'confirmed_suggestion', needs_review = 0, plan_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'suggested'"
			)
			.bind(planId, group.id)
	);
	const { results: evidence } = await db
		.prepare('SELECT transaction_id FROM recurring_group_transactions WHERE recurring_group_id = ?')
		.bind(group.id)
		.all<EvidenceIdRow>();
	for (const entry of evidence)
		statements.push(
			db
				.prepare('INSERT OR IGNORE INTO plan_transactions (plan_id, transaction_id) VALUES (?, ?)')
				.bind(planId, entry.transaction_id)
		);
	await runBatch(db, statements);
	const plan = await getPlan(db, planId);
	if (!plan) throw new NotFoundError('Created plan could not be loaded');
	return plan;
}

export async function rebuildRecurringSuggestions(
	db: DbClient,
	asOf = todayIso()
): Promise<RecurringGroup[]> {
	await normalizeExistingRecurringKeys(db);
	await db.prepare("DELETE FROM recurring_groups WHERE status = 'suggested'").run();
	return generateRecurringSuggestions(db, asOf);
}

async function normalizeExistingRecurringKeys(db: DbClient): Promise<void> {
	const { results } = await db
		.prepare("SELECT id, payee FROM recurring_groups WHERE status IN ('confirmed', 'ignored')")
		.all<ExistingPayeeRow>();
	const statements = results.map((row) =>
		db
			.prepare(
				'UPDATE recurring_groups SET canonical_payee_key = ?, detector_version = ? WHERE id = ?'
			)
			.bind(canonicalizePayee(row.payee), detectorVersion, row.id)
	);
	if (statements.length > 0) await runBatch(db, statements);
}

export async function generateRecurringSuggestions(
	db: DbClient,
	asOf = todayIso()
): Promise<RecurringGroup[]> {
	const candidates = groupRecurringCandidates(await listCandidateTransactions(db));
	const existingGroups = await listExistingRecurringGroups(db);
	const suggestions: RecurringGroup[] = [];

	for (const candidate of candidates) {
		const pattern = inferRecurringPattern(candidate.transactions, asOf);
		if (!pattern || pattern.confidence < minimumConfidence) continue;
		if (hasExistingRecurringGroup(existingGroups, candidate, pattern)) continue;

		const groupId = crypto.randomUUID();
		const statements = [
			insertRecurringSuggestionStatement(db, groupId, candidate, pattern),
			...latestThreeTransactions(candidate.transactions).map((transaction) =>
				linkRecurringTransactionStatement(db, groupId, transaction.id)
			)
		];
		await runBatch(db, statements);
		const suggestion = await getRecurringGroup(db, groupId);
		if (suggestion) {
			suggestions.push(suggestion);
			existingGroups.push({
				id: suggestion.id,
				account_id: suggestion.accountId,
				direction: suggestion.direction,
				cadence: suggestion.cadence,
				canonical_payee_key: suggestion.canonicalPayeeKey,
				expected_amount_cents: suggestion.expectedAmountCents
			});
		}
	}

	return suggestions;
}

export async function updateRecurringGroup(
	db: DbClient,
	input: UpdateRecurringGroupInput
): Promise<RecurringGroup> {
	const existing = await getRecurringGroup(db, input.id);
	if (!existing) throw new NotFoundError('Recurring group not found');
	if (existing.status !== 'suggested')
		throw new ValidationError('Only open recurring suggestions can be updated');
	await assertOptionalLinks(db, input.accountId, input.categoryId);

	const direction = input.direction ?? existing.direction;
	const categoryId = input.categoryId === undefined ? existing.categoryId : input.categoryId;
	const cadence = input.cadence ?? existing.cadence;
	const amount = input.expectedAmountCents ?? existing.expectedAmountCents;
	const nextDate = input.nextDate === undefined ? existing.nextDate : input.nextDate;
	const endDate = input.endDate === undefined ? existing.endDate : input.endDate;
	if (nextDate && endDate && endDate < nextDate)
		throw new ValidationError('endDate must be on or after nextDate');

	const payee = input.payee ?? existing.payee;
	const label = input.label === undefined ? existing.label : input.label;
	await db
		.prepare(
			`UPDATE recurring_groups
			SET account_id = ?, category_id = ?, label = ?, payee = ?, direction = ?,
				canonical_payee_key = ?, cadence = ?, expected_amount_cents = ?, next_date = ?,
				end_date = ?,
				status = ?, confidence = ?, source = ?, needs_review = ?, detector_version = ?,
				updated_at = CURRENT_TIMESTAMP
			WHERE id = ?`
		)
		.bind(
			input.accountId === undefined ? existing.accountId : input.accountId,
			categoryId,
			label,
			payee,
			direction,
			canonicalizePayee(payee),
			cadence,
			amount,
			nextDate,
			endDate,
			input.status ?? existing.status,
			input.confidence ?? existing.confidence,
			input.source ?? existing.source,
			input.status === 'ignored' ? 0 : existing.needsReview ? 1 : 0,
			detectorVersion,
			input.id
		)
		.run();

	const updated = await getRecurringGroup(db, input.id);
	if (!updated) throw new NotFoundError('Recurring group not found');
	return updated;
}

async function listCandidateTransactions(db: DbClient): Promise<CandidateTransactionRow[]> {
	const { results } = await db
		.prepare(
			`SELECT t.id, t.account_id, t.category_id, t.payee,
				t.booking_date, t.amount_cents, COALESCE(c.type, 'unknown') AS category_type
			FROM transactions t
			LEFT JOIN categories c ON c.id = t.category_id
			WHERE t.payee IS NOT NULL AND TRIM(t.payee) != '' AND t.amount_cents != 0
				AND COALESCE(c.type, 'unknown') != 'transfer'
				AND NOT EXISTS (
					SELECT 1 FROM transactions paired
					WHERE paired.id != t.id
						AND paired.amount_cents = -t.amount_cents
						AND ABS(julianday(paired.booking_date) - julianday(t.booking_date)) <= 1
						AND paired.account_id != t.account_id
				)
			ORDER BY t.account_id, LOWER(TRIM(t.payee)), t.booking_date`
		)
		.all<CandidateTransactionRow>();
	return results;
}

function groupRecurringCandidates(rows: CandidateTransactionRow[]): RecurringCandidate[] {
	const exactGroups = new Map<string, RecurringCandidate>();
	for (const row of rows) {
		const direction: RecurringDirection = row.amount_cents < 0 ? 'outgoing' : 'incoming';
		const canonicalPayeeKey = canonicalizePayee(row.payee);
		const exactKey = [row.account_id, direction, canonicalPayeeKey].join('|');
		const group = exactGroups.get(exactKey) ?? {
			accountId: row.account_id,
			categoryId: row.category_id,
			payee: row.payee.trim(),
			direction,
			canonicalPayeeKey,
			transactions: []
		};
		group.transactions.push(row);
		if (group.categoryId !== row.category_id) group.categoryId = null;
		exactGroups.set(exactKey, group);
	}

	return [...exactGroups.values()].flatMap(splitCandidateByAmount);
}

function splitCandidateByAmount(candidate: RecurringCandidate): RecurringCandidate[] {
	const groups: RecurringCandidate[] = [];
	for (const transaction of candidate.transactions) {
		const amount = Math.abs(transaction.amount_cents);
		const group = groups.find((item) =>
			amountsAreSimilar(
				average(item.transactions.map((entry) => Math.abs(entry.amount_cents))),
				amount
			)
		);
		if (group) {
			group.transactions.push(transaction);
		} else {
			groups.push({ ...candidate, transactions: [transaction] });
		}
	}
	return groups;
}

function inferRecurringPattern(
	transactions: CandidateTransactionRow[],
	asOf: string
): RecurringPattern | null {
	if (transactions.length < 3) return null;
	const sorted = [...transactions].sort((a, b) => a.booking_date.localeCompare(b.booking_date));
	const dailyPattern = inferDailyPattern(sorted, asOf);
	if (dailyPattern) return dailyPattern;
	const recent = sorted.slice(-3);
	const amounts = recent.map((transaction) => Math.abs(transaction.amount_cents));
	const expectedAmount = average(amounts);
	const tolerance = amountTolerance(expectedAmount);
	if (amounts.some((amount) => Math.abs(amount - expectedAmount) > tolerance)) return null;
	const maxDateDrift = 3;
	const window = cadenceWindows
		.filter(
			(item) =>
				item.cadence !== 'daily' &&
				recent
					.slice(1)
					.every(
						(transaction, index) =>
							cadenceDateMultiple(
								recent[index].booking_date,
								transaction.booking_date,
								item,
								maxDateDrift
							) !== null
					)
		)
		.sort(
			(left, right) =>
				cadenceFitScore(recent, left, maxDateDrift) - cadenceFitScore(recent, right, maxDateDrift)
		)[0];
	if (!window || window.cadence === 'daily') return null;
	const lastDate = recent[2].booking_date;
	const staleDays = daysBetween(lastDate, asOf);
	if (staleDays > window.maxStaleDays) return null;

	const intervalError = average(
		recent
			.slice(1)
			.map((transaction, index) =>
				cadenceDateError(recent[index].booking_date, transaction.booking_date, window, maxDateDrift)
			)
	);
	const amountErrorRatio =
		average(amounts.map((value) => Math.abs(value - expectedAmount))) / expectedAmount;
	const factors: RecurringConfidenceFactors = {
		interval: Math.max(
			0,
			Math.round(40 * (1 - intervalError / Math.max(1, window.maxDays - window.minDays)))
		),
		amount: Math.max(0, Math.round(30 * (1 - amountErrorRatio / amountToleranceRatio))),
		history: transactions.length >= 4 ? 20 : 10,
		recency: staleDays <= window.targetDays * 1.5 ? 10 : staleDays <= window.maxStaleDays ? 5 : 0
	};

	return {
		cadence: window.cadence,
		expectedAmountCents: Math.round(expectedAmount),
		nextDate: advanceToDate(lastDate, window.cadence, asOf),
		confidence: Object.values(factors).reduce((sum, value) => sum + value, 0),
		factors
	};
}

function cadenceFitScore(
	transactions: CandidateTransactionRow[],
	window: (typeof cadenceWindows)[number],
	maxDateDrift: number
): number {
	return average(
		transactions.slice(1).map((transaction, index) => {
			const from = transactions[index].booking_date;
			const multiple =
				cadenceDateMultiple(from, transaction.booking_date, window, maxDateDrift) ?? 1;
			return (
				cadenceDateError(from, transaction.booking_date, window, maxDateDrift) + (multiple - 1) * 2
			);
		})
	);
}

function cadenceDateMultiple(
	from: string,
	to: string,
	window: (typeof cadenceWindows)[number],
	maxDateDrift: number
): number | null {
	for (const multiple of [1, 2]) {
		const expected = addCadenceMultiple(from, window.cadence, multiple);
		if (Math.abs(daysBetween(expected, to)) <= maxDateDrift) return multiple;
	}
	return null;
}

function cadenceDateError(
	from: string,
	to: string,
	window: (typeof cadenceWindows)[number],
	maxDateDrift: number
): number {
	const multiple = cadenceDateMultiple(from, to, window, maxDateDrift) ?? 1;
	return Math.abs(daysBetween(addCadenceMultiple(from, window.cadence, multiple), to));
}

function inferDailyPattern(
	transactions: CandidateTransactionRow[],
	asOf: string
): RecurringPattern | null {
	const byDate = new Map<string, CandidateTransactionRow>();
	for (const transaction of transactions) byDate.set(transaction.booking_date, transaction);
	const unique = [...byDate.values()].sort((a, b) => a.booking_date.localeCompare(b.booking_date));
	let current: CandidateTransactionRow[] = [];
	let longest: CandidateTransactionRow[] = [];
	for (const transaction of unique) {
		if (
			current.length === 0 ||
			daysBetween(current[current.length - 1].booking_date, transaction.booking_date) === 1
		) {
			current.push(transaction);
		} else {
			current = [transaction];
		}
		if (current.length > longest.length) longest = [...current];
	}
	if (longest.length < 7) return null;

	const amounts = longest.map((transaction) => Math.abs(transaction.amount_cents));
	const expectedAmount = average(amounts);
	if (amounts.some((amount) => amount !== expectedAmount)) {
		return null;
	}
	const lastDate = longest[longest.length - 1].booking_date;
	const staleDays = daysBetween(lastDate, asOf);
	const factors: RecurringConfidenceFactors = {
		interval: 40,
		amount: 30,
		history: Math.min(20, 5 + Math.floor(((longest.length - 7) * 15) / 14)),
		recency: staleDays <= 2 ? 10 : staleDays <= 14 ? 5 : 0
	};
	return {
		cadence: 'daily',
		expectedAmountCents: Math.round(expectedAmount),
		nextDate: advanceToDate(lastDate, 'daily', asOf),
		confidence: Object.values(factors).reduce((sum, value) => sum + value, 0),
		factors
	};
}

function hasExistingRecurringGroup(
	groups: ExistingRecurringRow[],
	candidate: RecurringCandidate,
	pattern: RecurringPattern
): boolean {
	return groups.some(
		(row) =>
			row.account_id === candidate.accountId &&
			row.direction === candidate.direction &&
			row.cadence === pattern.cadence &&
			row.canonical_payee_key === candidate.canonicalPayeeKey &&
			amountsAreSimilar(row.expected_amount_cents, pattern.expectedAmountCents)
	);
}

async function listExistingRecurringGroups(db: DbClient): Promise<ExistingRecurringRow[]> {
	const { results } = await db
		.prepare(
			`SELECT id, account_id, direction, cadence, canonical_payee_key, expected_amount_cents
			FROM recurring_groups`
		)
		.all<ExistingRecurringRow>();
	return results;
}

function insertRecurringSuggestionStatement(
	db: DbClient,
	groupId: string,
	candidate: RecurringCandidate,
	pattern: RecurringPattern
): DbStatement {
	return db
		.prepare(
			`INSERT INTO recurring_groups (
				id, account_id, category_id, payee, direction, canonical_payee_key,
				cadence, expected_amount_cents, next_date, status, confidence, source,
				needs_review, detector_version
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'suggested', ?, 'imported', ?, ?)`
		)
		.bind(
			groupId,
			candidate.accountId,
			candidate.categoryId,
			candidate.payee,
			candidate.direction,
			candidate.canonicalPayeeKey,
			pattern.cadence,
			pattern.expectedAmountCents,
			pattern.nextDate,
			pattern.confidence,
			candidate.categoryId ? 0 : 1,
			detectorVersion
		);
}

function linkRecurringTransactionStatement(
	db: DbClient,
	groupId: string,
	transactionId: string
): DbStatement {
	return db
		.prepare(
			`INSERT OR IGNORE INTO recurring_group_transactions (recurring_group_id, transaction_id)
			VALUES (?, ?)`
		)
		.bind(groupId, transactionId);
}

async function runBatch(db: DbClient, statements: DbStatement[]): Promise<void> {
	if (db.batch) {
		await db.batch(statements);
		return;
	}
	for (const statement of statements) await statement.run();
}

async function getRecurringGroup(db: DbClient, id: string): Promise<RecurringGroup | null> {
	const row = await db
		.prepare(`${recurringGroupSelect()} WHERE rg.id = ?`)
		.bind(id)
		.first<RecurringGroupRow>();
	if (!row) return null;
	const evidence = await listRecurringEvidence(db, id);
	return mapRecurringGroup(row, evidence.get(id) ?? []);
}

async function listRecurringEvidence(
	db: DbClient,
	groupId?: string
): Promise<Map<string, RecurringEvidence[]>> {
	const clause = groupId ? 'WHERE rgt.recurring_group_id = ?' : '';
	const statement = db.prepare(
		`SELECT rgt.recurring_group_id, t.id AS transaction_id, t.booking_date, t.amount_cents,
			t.payee, t.description
		FROM recurring_group_transactions rgt
		INNER JOIN transactions t ON t.id = rgt.transaction_id
		${clause}
		ORDER BY rgt.recurring_group_id, t.booking_date DESC, t.id DESC`
	);
	const { results } = groupId
		? await statement.bind(groupId).all<EvidenceRow>()
		: await statement.all<EvidenceRow>();
	const map = new Map<string, RecurringEvidence[]>();
	for (const row of results) {
		const entries = map.get(row.recurring_group_id) ?? [];
		if (entries.length < 3) {
			entries.push({
				transactionId: row.transaction_id,
				bookingDate: row.booking_date,
				amountCents: row.amount_cents,
				payee: row.payee,
				description: row.description
			});
			map.set(row.recurring_group_id, entries);
		}
	}
	return map;
}

function recurringGroupSelect(): string {
	return `SELECT rg.id, rg.account_id, a.name AS account_name,
		rg.category_id, c.name AS category_name, rg.label, rg.payee,
		rg.direction, rg.canonical_payee_key, rg.cadence, rg.expected_amount_cents,
		rg.next_date, rg.end_date, rg.status, rg.confidence, rg.source, rg.needs_review,
		rg.detector_version,
		(SELECT COUNT(*) FROM recurring_group_transactions rgt WHERE rgt.recurring_group_id = rg.id)
			AS transaction_count,
		rg.created_at, rg.updated_at
	FROM recurring_groups rg
	LEFT JOIN accounts a ON a.id = rg.account_id
	LEFT JOIN categories c ON c.id = rg.category_id`;
}

async function assertOptionalLinks(
	db: DbClient,
	accountId?: string | null,
	categoryId?: string | null
): Promise<void> {
	if (accountId) await assertExists(db, 'accounts', accountId, 'Account not found');
	if (categoryId) await assertExists(db, 'categories', categoryId, 'Category not found');
}

async function assertExists(
	db: DbClient,
	table: 'accounts' | 'categories',
	id: string,
	message: string
): Promise<void> {
	const row = await db.prepare(`SELECT id FROM ${table} WHERE id = ?`).bind(id).first<IdRow>();
	if (!row) throw new NotFoundError(message);
}

function latestThreeTransactions(
	transactions: CandidateTransactionRow[]
): CandidateTransactionRow[] {
	return [...transactions].sort((a, b) => a.booking_date.localeCompare(b.booking_date)).slice(-3);
}

export function canonicalizePayee(payee: string): string {
	const ignored = new Set([
		'gmbh',
		'ag',
		'se',
		'kg',
		'co',
		'ltd',
		'inc',
		'sarl',
		's',
		'a',
		'rl',
		'deutschland',
		'germany',
		'subscription',
		'subscr',
		'payment',
		'payments'
	]);
	const tokens = payee
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/\b([a-z])\s*[.-]\s*([a-z]{2,})\b/g, '$1$2')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
		.split(/\s+/)
		.filter((token) => token.length > 1 && !ignored.has(token));
	return [...new Set(tokens)].sort().join(' ') || payee.trim().toLowerCase();
}

function amountsAreSimilar(left: number, right: number): boolean {
	return Math.abs(left - right) <= amountTolerance(average([Math.abs(left), Math.abs(right)]));
}

function amountTolerance(amount: number): number {
	return Math.min(amountToleranceCents, Math.max(1, amount * amountToleranceRatio));
}

function average(values: number[]): number {
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function daysBetween(from: string, to: string): number {
	return Math.round(
		(new Date(`${to}T00:00:00.000Z`).getTime() - new Date(`${from}T00:00:00.000Z`).getTime()) /
			86_400_000
	);
}

function advanceToDate(
	date: string,
	cadence: RecurringGroup['cadence'],
	minimumDate: string
): string {
	let index = 1;
	let next = occurrenceDate(date, cadence, index);
	while (next < minimumDate) {
		index += 1;
		next = occurrenceDate(date, cadence, index);
	}
	return next;
}

function rollForwardToDate(
	date: string,
	cadence: RecurringGroup['cadence'],
	minimumDate: string
): string {
	let index = 0;
	let next = date;
	while (next < minimumDate) {
		index += 1;
		next = occurrenceDate(date, cadence, index);
	}
	return next;
}

function addCadenceMultiple(
	date: string,
	cadence: RecurringGroup['cadence'],
	multiple: number
): string {
	return occurrenceDate(date, cadence, multiple);
}

function todayIso(): string {
	return new Date().toISOString().slice(0, 10);
}

function mapRecurringGroup(row: RecurringGroupRow, evidence: RecurringEvidence[]): RecurringGroup {
	const confidenceFactors = inferFactorsFromConfidence(
		row.confidence,
		Number(row.transaction_count)
	);
	return {
		id: row.id,
		accountId: row.account_id,
		accountName: row.account_name,
		categoryId: row.category_id,
		categoryName: row.category_name,
		label: row.label,
		payee: row.payee,
		direction: row.direction,
		canonicalPayeeKey: row.canonical_payee_key,
		cadence: row.cadence,
		expectedAmountCents: row.expected_amount_cents,
		nextDate: row.next_date,
		endDate: row.end_date,
		status: row.status,
		confidence: row.confidence,
		confidenceFactors,
		source: row.source,
		needsReview: row.needs_review === 1,
		detectorVersion: row.detector_version,
		transactionCount: Number(row.transaction_count),
		evidence,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

function inferFactorsFromConfidence(confidence: number, count: number): RecurringConfidenceFactors {
	const history = count >= 4 ? 20 : 10;
	const remaining = Math.max(0, confidence - history);
	return {
		interval: Math.min(40, Math.round(remaining * 0.5)),
		amount: Math.min(30, Math.round(remaining * 0.375)),
		history,
		recency: Math.min(10, Math.max(0, confidence - history - Math.round(remaining * 0.875)))
	};
}

interface RecurringGroupRow extends DbRow {
	id: string;
	account_id: string | null;
	account_name: string | null;
	category_id: string | null;
	category_name: string | null;
	label: string | null;
	payee: string;
	direction: RecurringDirection | null;
	canonical_payee_key: string;
	cadence: RecurringGroup['cadence'];
	expected_amount_cents: number;
	next_date: string | null;
	end_date: string | null;
	status: RecurringGroup['status'];
	confidence: number;
	source: RecurringGroup['source'];
	needs_review: number;
	detector_version: number;
	transaction_count: number;
	created_at: string;
	updated_at: string;
}
interface EvidenceRow extends DbRow {
	recurring_group_id: string;
	transaction_id: string;
	booking_date: string;
	amount_cents: number;
	payee: string | null;
	description: string | null;
}
interface CandidateTransactionRow extends DbRow {
	id: string;
	account_id: string;
	category_id: string | null;
	payee: string;
	booking_date: string;
	amount_cents: number;
	category_type: string;
}
interface RecurringCandidate {
	accountId: string;
	categoryId: string | null;
	payee: string;
	direction: RecurringDirection;
	canonicalPayeeKey: string;
	transactions: CandidateTransactionRow[];
}
interface RecurringPattern {
	cadence: RecurringGroup['cadence'];
	expectedAmountCents: number;
	nextDate: string;
	confidence: number;
	factors: RecurringConfidenceFactors;
}
interface IdRow extends DbRow {
	id: string;
}
interface ExistingPayeeRow extends DbRow {
	id: string;
	payee: string;
}
interface EvidenceIdRow extends DbRow {
	transaction_id: string;
}
interface ExistingRecurringRow extends DbRow {
	id: string;
	account_id: string | null;
	direction: RecurringDirection | null;
	cadence: RecurringGroup['cadence'];
	canonical_payee_key: string;
	expected_amount_cents: number;
}
