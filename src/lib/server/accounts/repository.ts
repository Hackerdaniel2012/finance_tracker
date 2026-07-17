import type { DbClient, DbRow } from '../db-client';
import { listCalculatedAccountBalances } from './balance';
import { NotFoundError } from './errors';
import type { Account, AccountWithBalance, CreateAccountInput, UpdateAccountInput } from './types';

export async function listAccounts(db: DbClient): Promise<AccountWithBalance[]> {
	const [{ results }, balances] = await Promise.all([
		db
			.prepare(
				`SELECT
					a.id AS account_id,
					a.name AS account_name,
					a.institution,
					a.currency,
					a.display_order,
					a.created_at AS account_created_at,
					a.updated_at AS account_updated_at
				FROM accounts a
				ORDER BY a.display_order ASC, a.created_at ASC`
			)
			.all<AccountRowWithBalance>(),
		listCalculatedAccountBalances(db, today())
	]);

	return results.map((row) => {
		const balance = balances.find((item) => item.accountId === row.account_id);
		return mapAccountWithBalance(row, balance?.balanceCents ?? null);
	});
}

export async function createAccount(db: DbClient, input: CreateAccountInput): Promise<Account> {
	const id = crypto.randomUUID();

	await db
		.prepare(
			`INSERT INTO accounts (
				id, name, institution, display_order
			) VALUES (?, ?, ?, ?)`
		)
		.bind(id, input.name, input.institution ?? null, input.displayOrder ?? 0)
		.run();

	const account = await getAccount(db, id);
	if (!account) {
		throw new NotFoundError('Created account could not be loaded');
	}

	return account;
}

export async function updateAccount(db: DbClient, input: UpdateAccountInput): Promise<Account> {
	const existing = await getAccount(db, input.id);
	if (!existing) {
		throw new NotFoundError('Account not found');
	}

	await db
		.prepare(
			`UPDATE accounts
			SET
				name = ?,
				institution = ?,
				display_order = ?,
				updated_at = CURRENT_TIMESTAMP
			WHERE id = ?`
		)
		.bind(
			input.name ?? existing.name,
			input.institution === undefined ? existing.institution : input.institution,
			input.displayOrder ?? existing.displayOrder,
			input.id
		)
		.run();

	const updated = await getAccount(db, input.id);
	if (!updated) {
		throw new NotFoundError('Account not found');
	}

	return updated;
}

export async function deleteAccount(db: DbClient, id: string): Promise<void> {
	if (!(await getAccount(db, id))) {
		throw new NotFoundError('Account not found');
	}

	await db.prepare('DELETE FROM accounts WHERE id = ?').bind(id).run();
}

export async function getAccount(db: DbClient, id: string): Promise<Account | null> {
	const row = await db
		.prepare(
			`SELECT id, name, institution, currency,
				display_order, created_at, updated_at
			FROM accounts
			WHERE id = ?`
		)
		.bind(id)
		.first<AccountRow>();

	return row ? mapAccount(row) : null;
}

interface AccountRow extends DbRow {
	id: string;
	name: string;
	institution: string | null;
	currency: 'EUR';
	display_order: number;
	created_at: string;
	updated_at: string;
}

interface AccountRowWithBalance extends DbRow {
	account_id: string;
	account_name: string;
	institution: string | null;
	currency: 'EUR';
	display_order: number;
	account_created_at: string;
	account_updated_at: string;
}

function mapAccount(row: AccountRow): Account {
	return {
		id: row.id,
		name: row.name,
		institution: row.institution,
		currency: row.currency,
		displayOrder: row.display_order,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

function mapAccountWithBalance(
	row: AccountRowWithBalance,
	balanceCents: number | null
): AccountWithBalance {
	return {
		id: row.account_id,
		name: row.account_name,
		institution: row.institution,
		currency: row.currency,
		balanceCents,
		balanceInitialized: balanceCents !== null,
		displayOrder: row.display_order,
		createdAt: row.account_created_at,
		updatedAt: row.account_updated_at
	};
}

function today(): string {
	return new Date().toISOString().slice(0, 10);
}
