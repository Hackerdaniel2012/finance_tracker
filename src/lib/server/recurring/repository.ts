import { NotFoundError } from '../accounts/errors';
import type { DbClient, DbRow } from '../db-client';
import type { RecurringGroup, UpdateRecurringGroupInput } from './types';

const monthlyCadenceMinDays = 27;
const monthlyCadenceMaxDays = 34;
const amountToleranceCents = 100;
const amountToleranceRatio = 0.05;

export async function listRecurringGroups(db: DbClient): Promise<RecurringGroup[]> {
	const { results } = await db
		.prepare(`${recurringGroupSelect()} ORDER BY rg.status ASC, rg.next_date ASC, rg.payee ASC`)
		.all<RecurringGroupRow>();

	return results.map(mapRecurringGroup);
}

export async function generateRecurringSuggestions(db: DbClient): Promise<RecurringGroup[]> {
	const candidates = groupRecurringCandidates(await listCandidateTransactions(db));
	const suggestions: RecurringGroup[] = [];

	for (const candidate of candidates) {
		if (!isMonthlyCandidate(candidate.transactions)) {
			continue;
		}

		const existing = await getExistingRecurringGroup(db, candidate);
		if (existing) {
			continue;
		}

		const groupId = crypto.randomUUID();
		await insertRecurringSuggestion(db, groupId, candidate);
		await linkRecurringTransactions(db, groupId, candidate.transactions);
		const suggestion = await getRecurringGroup(db, groupId);
		if (suggestion) {
			suggestions.push(suggestion);
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

	await db
		.prepare(
			`UPDATE recurring_groups
			SET
				account_id = ?,
				profile_id = ?,
				category_id = ?,
				payee = ?,
				cadence = ?,
				expected_amount_cents = ?,
				next_date = ?,
				status = ?,
				confidence = ?,
				source = ?,
				updated_at = CURRENT_TIMESTAMP
			WHERE id = ?`
		)
		.bind(
			input.accountId === undefined ? existing.accountId : input.accountId,
			input.profileId === undefined ? existing.profileId : input.profileId,
			input.categoryId === undefined ? existing.categoryId : input.categoryId,
			input.payee ?? existing.payee,
			input.cadence ?? existing.cadence,
			input.expectedAmountCents ?? existing.expectedAmountCents,
			input.nextDate === undefined ? existing.nextDate : input.nextDate,
			input.status ?? existing.status,
			input.confidence ?? existing.confidence,
			input.source ?? existing.source,
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
			`SELECT
				t.id,
				t.account_id,
				t.profile_id,
				t.category_id,
				t.payee,
				t.booking_date,
				t.amount_cents,
				COALESCE(c.type, 'unknown') AS category_type
			FROM transactions t
			LEFT JOIN categories c ON c.id = t.category_id
			WHERE t.payee IS NOT NULL
				AND TRIM(t.payee) != ''
				AND t.amount_cents != 0
				AND COALESCE(c.type, 'unknown') != 'transfer'
			ORDER BY t.account_id ASC, LOWER(TRIM(t.payee)) ASC, ABS(t.amount_cents) ASC, t.booking_date ASC`
		)
		.all<CandidateTransactionRow>();

	return results;
}

function groupRecurringCandidates(rows: CandidateTransactionRow[]): RecurringCandidate[] {
	const groups = new Map<string, RecurringCandidate>();
	for (const row of rows) {
		const key = [
			row.account_id,
			row.category_id ?? '',
			row.amount_cents < 0 ? 'outgoing' : 'incoming',
			normalizePayee(row.payee)
		].join('|');
		const existing =
			groups.get(key) ??
			({
				accountId: row.account_id,
				profileId: row.profile_id,
				categoryId: row.category_id,
				payee: row.payee.trim(),
				transactions: []
			} satisfies RecurringCandidate);
		existing.transactions.push(row);
		groups.set(key, existing);
	}

	return [...groups.values()];
}

function isMonthlyCandidate(transactions: CandidateTransactionRow[]): boolean {
	if (transactions.length < 3) {
		return false;
	}

	const sorted = [...transactions].sort((a, b) => a.booking_date.localeCompare(b.booking_date));
	const recent = sorted.slice(-3);
	const amounts = recent.map((transaction) => Math.abs(transaction.amount_cents));
	const expectedAmount = average(amounts);
	if (
		amounts.some(
			(amount) =>
				Math.abs(amount - expectedAmount) >
				Math.max(amountToleranceCents, expectedAmount * amountToleranceRatio)
		)
	) {
		return false;
	}

	const intervals = [
		daysBetween(recent[0].booking_date, recent[1].booking_date),
		daysBetween(recent[1].booking_date, recent[2].booking_date)
	];

	return intervals.every(
		(interval) => interval >= monthlyCadenceMinDays && interval <= monthlyCadenceMaxDays
	);
}

async function getExistingRecurringGroup(
	db: DbClient,
	candidate: RecurringCandidate
): Promise<IdRow | null> {
	return db
		.prepare(
			`SELECT id
			FROM recurring_groups
			WHERE account_id = ?
				AND cadence = 'monthly'
				AND LOWER(TRIM(payee)) = ?
			LIMIT 1`
		)
		.bind(candidate.accountId, normalizePayee(candidate.payee))
		.first<IdRow>();
}

async function insertRecurringSuggestion(
	db: DbClient,
	groupId: string,
	candidate: RecurringCandidate
): Promise<void> {
	const recent = latestThreeTransactions(candidate.transactions);
	const expectedAmountCents = Math.round(
		average(recent.map((transaction) => Math.abs(transaction.amount_cents)))
	);

	await db
		.prepare(
			`INSERT INTO recurring_groups (
				id, account_id, profile_id, category_id, payee, cadence, expected_amount_cents,
				next_date, status, confidence, source
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			groupId,
			candidate.accountId,
			candidate.profileId,
			candidate.categoryId,
			candidate.payee,
			'monthly',
			expectedAmountCents,
			nextMonthlyDate(recent.at(-1)?.booking_date ?? null),
			'suggested',
			90,
			'imported'
		)
		.run();
}

async function linkRecurringTransactions(
	db: DbClient,
	groupId: string,
	transactions: CandidateTransactionRow[]
): Promise<void> {
	for (const transaction of latestThreeTransactions(transactions)) {
		await db
			.prepare(
				`INSERT OR IGNORE INTO recurring_group_transactions (recurring_group_id, transaction_id)
				VALUES (?, ?)`
			)
			.bind(groupId, transaction.id)
			.run();
	}
}

async function getRecurringGroup(db: DbClient, id: string): Promise<RecurringGroup | null> {
	const row = await db
		.prepare(`${recurringGroupSelect()} WHERE rg.id = ?`)
		.bind(id)
		.first<RecurringGroupRow>();

	return row ? mapRecurringGroup(row) : null;
}

function recurringGroupSelect(): string {
	return `SELECT
		rg.id,
		rg.account_id,
		a.name AS account_name,
		rg.profile_id,
		p.label AS profile_label,
		rg.category_id,
		c.name AS category_name,
		rg.payee,
		rg.cadence,
		rg.expected_amount_cents,
		rg.next_date,
		rg.status,
		rg.confidence,
		rg.source,
		(
			SELECT COUNT(*)
			FROM recurring_group_transactions rgt
			WHERE rgt.recurring_group_id = rg.id
		) AS transaction_count,
		rg.created_at,
		rg.updated_at
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

function normalizePayee(payee: string): string {
	return payee.trim().replace(/\s+/g, ' ').toLowerCase();
}

function average(values: number[]): number {
	return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function daysBetween(from: string, to: string): number {
	const fromDate = new Date(`${from}T00:00:00.000Z`);
	const toDate = new Date(`${to}T00:00:00.000Z`);
	return Math.round((toDate.getTime() - fromDate.getTime()) / 86_400_000);
}

function nextMonthlyDate(date: string | null): string | null {
	if (!date) {
		return null;
	}

	const next = new Date(`${date}T00:00:00.000Z`);
	next.setUTCMonth(next.getUTCMonth() + 1);
	return next.toISOString().slice(0, 10);
}

function mapRecurringGroup(row: RecurringGroupRow): RecurringGroup {
	return {
		id: row.id,
		accountId: row.account_id,
		accountName: row.account_name,
		profileId: row.profile_id,
		profileLabel: row.profile_label,
		categoryId: row.category_id,
		categoryName: row.category_name,
		payee: row.payee,
		cadence: row.cadence,
		expectedAmountCents: row.expected_amount_cents,
		nextDate: row.next_date,
		status: row.status,
		confidence: row.confidence,
		source: row.source,
		transactionCount: Number(row.transaction_count),
		createdAt: row.created_at,
		updatedAt: row.updated_at
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
	cadence: RecurringGroup['cadence'];
	expected_amount_cents: number;
	next_date: string | null;
	status: RecurringGroup['status'];
	confidence: number;
	source: RecurringGroup['source'];
	transaction_count: number;
	created_at: string;
	updated_at: string;
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
	transactions: CandidateTransactionRow[];
}

interface IdRow extends DbRow {
	id: string;
}
