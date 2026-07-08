import { NotFoundError } from '../accounts/errors';
import type { DbClient, DbRow } from '../db-client';
import type { RecurringGroup, UpdateRecurringGroupInput } from './types';

export async function listRecurringGroups(db: DbClient): Promise<RecurringGroup[]> {
	const { results } = await db
		.prepare(`${recurringGroupSelect()} ORDER BY rg.status ASC, rg.next_date ASC, rg.payee ASC`)
		.all<RecurringGroupRow>();

	return results.map(mapRecurringGroup);
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

interface IdRow extends DbRow {
	id: string;
}
