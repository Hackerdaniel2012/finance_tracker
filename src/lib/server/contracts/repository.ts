import { NotFoundError } from '../accounts/errors';
import type { DbClient, DbRow } from '../db-client';
import type { Contract, CreateContractInput, UpdateContractInput } from './types';

export async function listContracts(db: DbClient): Promise<Contract[]> {
	const { results } = await db
		.prepare(`${contractSelect()} ORDER BY c.status ASC, c.next_date ASC, c.name ASC`)
		.all<ContractRow>();

	return results.map(mapContract);
}

export async function createContract(db: DbClient, input: CreateContractInput): Promise<Contract> {
	await assertOptionalLinks(db, input.accountId, input.profileId, input.categoryId);
	const id = crypto.randomUUID();

	await db
		.prepare(
			`INSERT INTO contracts (
				id, account_id, profile_id, category_id, name, payee, kind, cadence,
				expected_amount_cents, next_date, end_date, status, source
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			id,
			input.accountId ?? null,
			input.profileId ?? null,
			input.categoryId ?? null,
			input.name,
			input.payee ?? null,
			input.kind,
			input.cadence,
			input.expectedAmountCents,
			input.nextDate,
			input.endDate ?? null,
			input.status ?? 'active',
			input.source ?? 'manual'
		)
		.run();

	const contract = await getContract(db, id);
	if (!contract) throw new NotFoundError('Created contract could not be loaded');
	return contract;
}

export async function updateContract(db: DbClient, input: UpdateContractInput): Promise<Contract> {
	const existing = await getContract(db, input.id);
	if (!existing) throw new NotFoundError('Contract not found');
	await assertOptionalLinks(db, input.accountId, input.profileId, input.categoryId);

	await db
		.prepare(
			`UPDATE contracts
			SET
				account_id = ?,
				profile_id = ?,
				category_id = ?,
				name = ?,
				payee = ?,
				kind = ?,
				cadence = ?,
				expected_amount_cents = ?,
				next_date = ?,
				end_date = ?,
				status = ?,
				source = ?,
				updated_at = CURRENT_TIMESTAMP
			WHERE id = ?`
		)
		.bind(
			input.accountId === undefined ? existing.accountId : input.accountId,
			input.profileId === undefined ? existing.profileId : input.profileId,
			input.categoryId === undefined ? existing.categoryId : input.categoryId,
			input.name ?? existing.name,
			input.payee === undefined ? existing.payee : input.payee,
			input.kind ?? existing.kind,
			input.cadence ?? existing.cadence,
			input.expectedAmountCents ?? existing.expectedAmountCents,
			input.nextDate ?? existing.nextDate,
			input.endDate === undefined ? existing.endDate : input.endDate,
			input.status ?? existing.status,
			input.source ?? existing.source,
			input.id
		)
		.run();

	const contract = await getContract(db, input.id);
	if (!contract) throw new NotFoundError('Contract not found');
	return contract;
}

export async function deleteContract(db: DbClient, id: string): Promise<void> {
	if (!(await getContract(db, id))) throw new NotFoundError('Contract not found');
	await db.prepare('DELETE FROM contracts WHERE id = ?').bind(id).run();
}

async function getContract(db: DbClient, id: string): Promise<Contract | null> {
	const row = await db.prepare(`${contractSelect()} WHERE c.id = ?`).bind(id).first<ContractRow>();

	return row ? mapContract(row) : null;
}

function contractSelect(): string {
	return `SELECT
		c.id,
		c.account_id,
		a.name AS account_name,
		c.profile_id,
		p.label AS profile_label,
		c.category_id,
		cat.name AS category_name,
		c.name,
		c.payee,
		c.kind,
		c.cadence,
		c.expected_amount_cents,
		c.next_date,
		c.end_date,
		c.status,
		c.source,
		c.created_at,
		c.updated_at
	FROM contracts c
	LEFT JOIN accounts a ON a.id = c.account_id
	LEFT JOIN import_profiles p ON p.id = c.profile_id
	LEFT JOIN categories cat ON cat.id = c.category_id`;
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

function mapContract(row: ContractRow): Contract {
	return {
		id: row.id,
		accountId: row.account_id,
		accountName: row.account_name,
		profileId: row.profile_id,
		profileLabel: row.profile_label,
		categoryId: row.category_id,
		categoryName: row.category_name,
		name: row.name,
		payee: row.payee,
		kind: row.kind,
		cadence: row.cadence,
		expectedAmountCents: row.expected_amount_cents,
		nextDate: row.next_date,
		endDate: row.end_date,
		status: row.status,
		source: row.source,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

interface ContractRow extends DbRow {
	id: string;
	account_id: string | null;
	account_name: string | null;
	profile_id: string | null;
	profile_label: string | null;
	category_id: string | null;
	category_name: string | null;
	name: string;
	payee: string | null;
	kind: Contract['kind'];
	cadence: Contract['cadence'];
	expected_amount_cents: number;
	next_date: string;
	end_date: string | null;
	status: Contract['status'];
	source: Contract['source'];
	created_at: string;
	updated_at: string;
}

interface IdRow extends DbRow {
	id: string;
}
