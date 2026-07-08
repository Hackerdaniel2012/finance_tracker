import { NotFoundError } from '../accounts/errors';
import type { DbClient, DbRow } from '../db-client';
import type { CreateLiabilityInput, Liability, UpdateLiabilityInput } from './types';

export async function listLiabilities(db: DbClient): Promise<Liability[]> {
	const { results } = await db
		.prepare(
			`SELECT
				l.id,
				l.account_id,
				a.name AS account_name,
				l.name,
				l.amount_cents,
				l.as_of_date,
				l.status,
				l.note,
				l.created_at,
				l.updated_at
			FROM marked_liabilities l
			LEFT JOIN accounts a ON a.id = l.account_id
			ORDER BY l.status ASC, l.as_of_date DESC, l.name ASC`
		)
		.all<LiabilityRow>();

	return results.map(mapLiability);
}

export async function createLiability(
	db: DbClient,
	input: CreateLiabilityInput
): Promise<Liability> {
	if (input.accountId) {
		await assertAccountExists(db, input.accountId);
	}

	const id = crypto.randomUUID();
	await db
		.prepare(
			`INSERT INTO marked_liabilities (
				id, account_id, name, amount_cents, as_of_date, status, note
			) VALUES (?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			id,
			input.accountId ?? null,
			input.name,
			input.amountCents,
			input.asOfDate,
			input.status ?? 'active',
			input.note ?? null
		)
		.run();

	const liability = await getLiability(db, id);
	if (!liability) {
		throw new NotFoundError('Created liability could not be loaded');
	}

	return liability;
}

export async function updateLiability(
	db: DbClient,
	input: UpdateLiabilityInput
): Promise<Liability> {
	const existing = await getLiability(db, input.id);
	if (!existing) {
		throw new NotFoundError('Liability not found');
	}

	if (input.accountId) {
		await assertAccountExists(db, input.accountId);
	}

	await db
		.prepare(
			`UPDATE marked_liabilities
			SET
				account_id = ?,
				name = ?,
				amount_cents = ?,
				as_of_date = ?,
				status = ?,
				note = ?,
				updated_at = CURRENT_TIMESTAMP
			WHERE id = ?`
		)
		.bind(
			input.accountId === undefined ? existing.accountId : input.accountId,
			input.name ?? existing.name,
			input.amountCents ?? existing.amountCents,
			input.asOfDate ?? existing.asOfDate,
			input.status ?? existing.status,
			input.note === undefined ? existing.note : input.note,
			input.id
		)
		.run();

	const liability = await getLiability(db, input.id);
	if (!liability) {
		throw new NotFoundError('Liability not found');
	}

	return liability;
}

export async function deleteLiability(db: DbClient, id: string): Promise<void> {
	const liability = await getLiability(db, id);
	if (!liability) {
		throw new NotFoundError('Liability not found');
	}

	await db.prepare('DELETE FROM marked_liabilities WHERE id = ?').bind(id).run();
}

async function getLiability(db: DbClient, id: string): Promise<Liability | null> {
	const row = await db
		.prepare(
			`SELECT
				l.id,
				l.account_id,
				a.name AS account_name,
				l.name,
				l.amount_cents,
				l.as_of_date,
				l.status,
				l.note,
				l.created_at,
				l.updated_at
			FROM marked_liabilities l
			LEFT JOIN accounts a ON a.id = l.account_id
			WHERE l.id = ?`
		)
		.bind(id)
		.first<LiabilityRow>();

	return row ? mapLiability(row) : null;
}

async function assertAccountExists(db: DbClient, accountId: string): Promise<void> {
	const row = await db
		.prepare('SELECT id FROM accounts WHERE id = ?')
		.bind(accountId)
		.first<IdRow>();

	if (!row) {
		throw new NotFoundError('Account not found');
	}
}

function mapLiability(row: LiabilityRow): Liability {
	return {
		id: row.id,
		accountId: row.account_id,
		accountName: row.account_name,
		name: row.name,
		amountCents: row.amount_cents,
		asOfDate: row.as_of_date,
		status: row.status,
		note: row.note,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

interface LiabilityRow extends DbRow {
	id: string;
	account_id: string | null;
	account_name: string | null;
	name: string;
	amount_cents: number;
	as_of_date: string;
	status: 'active' | 'cleared';
	note: string | null;
	created_at: string;
	updated_at: string;
}

interface IdRow extends DbRow {
	id: string;
}
