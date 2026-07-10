import { NotFoundError, ValidationError } from '../accounts/errors';
import type { DbClient, DbRow, DbStatement } from '../db-client';
import type {
	RecurringConfidenceFactors,
	RecurringDirection,
	RecurringEvidence,
	RecurringGroup,
	UpdateRecurringGroupInput
} from './types';

const detectorVersion = 2;
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
	{ cadence: 'weekly', targetDays: 7, minDays: 6, maxDays: 8, maxStaleDays: 28 },
	{ cadence: 'biweekly', targetDays: 14, minDays: 12, maxDays: 16, maxStaleDays: 45 },
	{ cadence: 'monthly', targetDays: 30, minDays: 26, maxDays: 35, maxStaleDays: 75 },
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
	await assertOptionalLinks(db, input.accountId, input.profileId, input.categoryId);

	const direction = input.direction ?? existing.direction;
	const categoryId = input.categoryId === undefined ? existing.categoryId : input.categoryId;
	const cadence = input.cadence ?? existing.cadence;
	const amount = input.expectedAmountCents ?? existing.expectedAmountCents;
	let nextDate = input.nextDate === undefined ? existing.nextDate : input.nextDate;
	if (input.status === 'confirmed') {
		if (!direction || !categoryId || !nextDate) {
			throw new ValidationError(
				'Confirmed recurring groups require direction, category, and next date'
			);
		}
		nextDate = rollForwardToDate(nextDate, cadence, todayIso());
	}

	const payee = input.payee ?? existing.payee;
	await db
		.prepare(
			`UPDATE recurring_groups
			SET account_id = ?, profile_id = ?, category_id = ?, payee = ?, direction = ?,
				canonical_payee_key = ?, cadence = ?, expected_amount_cents = ?, next_date = ?,
				status = ?, confidence = ?, source = ?, needs_review = ?, detector_version = ?,
				updated_at = CURRENT_TIMESTAMP
			WHERE id = ?`
		)
		.bind(
			input.accountId === undefined ? existing.accountId : input.accountId,
			input.profileId === undefined ? existing.profileId : input.profileId,
			categoryId,
			payee,
			direction,
			canonicalizePayee(payee),
			cadence,
			amount,
			nextDate,
			input.status ?? existing.status,
			input.confidence ?? existing.confidence,
			input.source ?? (input.status === 'confirmed' ? 'confirmed_suggestion' : existing.source),
			input.status === 'confirmed' ? 0 : existing.needsReview ? 1 : 0,
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
			`SELECT t.id, t.account_id, t.profile_id, t.category_id, t.payee,
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
						AND (paired.account_id != t.account_id OR paired.profile_id = t.profile_id)
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
			profileId: row.profile_id,
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

	const merged: RecurringCandidate[] = [];
	const tokenIndex = new Map<string, RecurringCandidate[]>();
	for (const candidate of exactGroups.values()) {
		const amount = average(candidate.transactions.map((item) => Math.abs(item.amount_cents)));
		const tokens = candidate.canonicalPayeeKey.split(' ').filter((token) => token.length >= 3);
		const indexed = tokens.flatMap(
			(token) => tokenIndex.get([candidate.accountId, candidate.direction, token].join('|')) ?? []
		);
		const alias = indexed.find((item) =>
			amountsAreSimilar(
				average(item.transactions.map((transaction) => Math.abs(transaction.amount_cents))),
				amount
			)
		);
		if (alias) {
			alias.transactions.push(...candidate.transactions);
			if (alias.categoryId !== candidate.categoryId) alias.categoryId = null;
			alias.canonicalPayeeKey =
				sharedDistinctiveToken(alias.canonicalPayeeKey, candidate.canonicalPayeeKey) ??
				alias.canonicalPayeeKey;
			continue;
		}

		merged.push(candidate);
		for (const token of tokens) {
			const key = [candidate.accountId, candidate.direction, token].join('|');
			const entries = tokenIndex.get(key) ?? [];
			entries.push(candidate);
			tokenIndex.set(key, entries);
		}
	}
	return merged;
}

function inferRecurringPattern(
	transactions: CandidateTransactionRow[],
	asOf: string
): RecurringPattern | null {
	if (transactions.length < 3) return null;
	const sorted = [...transactions].sort((a, b) => a.booking_date.localeCompare(b.booking_date));
	const recent = sorted.slice(-3);
	const amounts = recent.map((transaction) => Math.abs(transaction.amount_cents));
	const expectedAmount = average(amounts);
	const tolerance = Math.max(amountToleranceCents, expectedAmount * amountToleranceRatio);
	if (amounts.some((amount) => Math.abs(amount - expectedAmount) > tolerance)) return null;

	const intervals = [
		daysBetween(recent[0].booking_date, recent[1].booking_date),
		daysBetween(recent[1].booking_date, recent[2].booking_date)
	];
	const window = cadenceWindows.find((item) =>
		intervals.every((interval) => interval >= item.minDays && interval <= item.maxDays)
	);
	if (!window) return null;
	const lastDate = recent[2].booking_date;
	const staleDays = daysBetween(lastDate, asOf);
	if (staleDays > window.maxStaleDays) return null;

	const intervalError = average(intervals.map((value) => Math.abs(value - window.targetDays)));
	const amountErrorRatio =
		average(amounts.map((value) => Math.abs(value - expectedAmount))) / expectedAmount;
	const factors: RecurringConfidenceFactors = {
		interval: Math.max(
			0,
			Math.round(40 * (1 - intervalError / Math.max(1, window.maxDays - window.minDays)))
		),
		amount: Math.max(0, Math.round(30 * (1 - amountErrorRatio / amountToleranceRatio))),
		history: transactions.length >= 4 ? 20 : 10,
		recency: staleDays <= window.targetDays * 1.5 ? 10 : 5
	};

	return {
		cadence: window.cadence,
		expectedAmountCents: Math.round(expectedAmount),
		nextDate: advanceToDate(lastDate, window.cadence, asOf),
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
			(row.canonical_payee_key === candidate.canonicalPayeeKey ||
				sharedDistinctiveToken(row.canonical_payee_key, candidate.canonicalPayeeKey) !== null) &&
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
				id, account_id, profile_id, category_id, payee, direction, canonical_payee_key,
				cadence, expected_amount_cents, next_date, status, confidence, source,
				needs_review, detector_version
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'suggested', ?, 'imported', ?, ?)`
		)
		.bind(
			groupId,
			candidate.accountId,
			candidate.profileId,
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
		`SELECT rgt.recurring_group_id, t.id AS transaction_id, t.booking_date, t.amount_cents, t.payee
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
				payee: row.payee
			});
			map.set(row.recurring_group_id, entries);
		}
	}
	return map;
}

function recurringGroupSelect(): string {
	return `SELECT rg.id, rg.account_id, a.name AS account_name, rg.profile_id,
		p.label AS profile_label, rg.category_id, c.name AS category_name, rg.payee,
		rg.direction, rg.canonical_payee_key, rg.cadence, rg.expected_amount_cents,
		rg.next_date, rg.status, rg.confidence, rg.source, rg.needs_review,
		rg.detector_version,
		(SELECT COUNT(*) FROM recurring_group_transactions rgt WHERE rgt.recurring_group_id = rg.id)
			AS transaction_count,
		rg.created_at, rg.updated_at
	FROM recurring_groups rg
	LEFT JOIN accounts a ON a.id = rg.account_id
	LEFT JOIN import_profiles p ON p.id = rg.profile_id
	LEFT JOIN categories c ON c.id = rg.category_id`;
}

async function assertOptionalLinks(
	db: DbClient,
	accountId?: string | null,
	profileId?: string | null,
	categoryId?: string | null
): Promise<void> {
	if (accountId) await assertExists(db, 'accounts', accountId, 'Account not found');
	if (profileId) await assertExists(db, 'import_profiles', profileId, 'Profile not found');
	if (categoryId) await assertExists(db, 'categories', categoryId, 'Category not found');
}

async function assertExists(
	db: DbClient,
	table: 'accounts' | 'import_profiles' | 'categories',
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

function sharedDistinctiveToken(left: string, right: string): string | null {
	const rightTokens = new Set(right.split(' '));
	return left.split(' ').find((token) => token.length >= 3 && rightTokens.has(token)) ?? null;
}

function amountsAreSimilar(left: number, right: number): boolean {
	return Math.abs(left - right) <= Math.max(amountToleranceCents, left * amountToleranceRatio);
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
	let next = date;
	do next = addCadence(next, cadence);
	while (next < minimumDate);
	return next;
}

function rollForwardToDate(
	date: string,
	cadence: RecurringGroup['cadence'],
	minimumDate: string
): string {
	let next = date;
	while (next < minimumDate) next = addCadence(next, cadence);
	return next;
}

function addCadence(date: string, cadence: RecurringGroup['cadence']): string {
	const next = new Date(`${date}T00:00:00.000Z`);
	switch (cadence) {
		case 'weekly':
			next.setUTCDate(next.getUTCDate() + 7);
			break;
		case 'biweekly':
			next.setUTCDate(next.getUTCDate() + 14);
			break;
		case 'monthly':
			next.setUTCMonth(next.getUTCMonth() + 1);
			break;
		case 'quarterly':
			next.setUTCMonth(next.getUTCMonth() + 3);
			break;
		case 'yearly':
			next.setUTCFullYear(next.getUTCFullYear() + 1);
			break;
	}
	return next.toISOString().slice(0, 10);
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
		profileId: row.profile_id,
		profileLabel: row.profile_label,
		categoryId: row.category_id,
		categoryName: row.category_name,
		payee: row.payee,
		direction: row.direction,
		canonicalPayeeKey: row.canonical_payee_key,
		cadence: row.cadence,
		expectedAmountCents: row.expected_amount_cents,
		nextDate: row.next_date,
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
	profile_id: string | null;
	profile_label: string | null;
	category_id: string | null;
	category_name: string | null;
	payee: string;
	direction: RecurringDirection | null;
	canonical_payee_key: string;
	cadence: RecurringGroup['cadence'];
	expected_amount_cents: number;
	next_date: string | null;
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
}
interface CandidateTransactionRow extends DbRow {
	id: string;
	account_id: string;
	profile_id: string;
	category_id: string | null;
	payee: string;
	booking_date: string;
	amount_cents: number;
	category_type: string;
}
interface RecurringCandidate {
	accountId: string;
	profileId: string;
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
interface ExistingRecurringRow extends DbRow {
	id: string;
	account_id: string | null;
	direction: RecurringDirection | null;
	cadence: RecurringGroup['cadence'];
	canonical_payee_key: string;
	expected_amount_cents: number;
}
