import type { DbClient, DbRow } from '../db-client';
import { NotFoundError } from './errors';
import type {
	Account,
	AccountWithBalance,
	CreateAccountInput,
	UpdateAccountInput
} from './types';

export async function listAccounts(db: DbClient): Promise<AccountWithBalance[]> {
	const [{ results }, subaccountsByAccountId] = await Promise.all([
		db
			.prepare(
				`SELECT
					a.id AS account_id,
					a.name AS account_name,
					a.institution,
					a.currency,
					a.opening_balance_cents,
					a.current_balance_cents,
					COALESCE(a.current_balance_cents, a.opening_balance_cents + COALESCE(tx.net_cents, 0)) AS balance_cents,
					a.display_order,
					a.created_at AS account_created_at,
					a.updated_at AS account_updated_at
				FROM accounts a
				LEFT JOIN (
					SELECT account_id, SUM(amount_cents) AS net_cents
					FROM transactions
					GROUP BY account_id
				) tx ON tx.account_id = a.id
				ORDER BY a.display_order ASC, a.created_at ASC`
			)
			.all<AccountRowWithBalance>(),
		getSubaccountsByAccountId(db)
	]);

	return results.map((row) =>
		mapAccountWithBalance(row, subaccountsByAccountId.get(row.account_id) ?? [])
	);
}

async function getSubaccountsByAccountId(db: DbClient): Promise<Map<string, string[]>> {
	const { results } = await db
		.prepare(
			`SELECT
				account_id,
				GROUP_CONCAT(DISTINCT subaccount) AS subaccounts
			FROM transactions
			WHERE subaccount IS NOT NULL
			GROUP BY account_id`
		)
		.all<SubaccountRow>();

	const map = new Map<string, string[]>();
	for (const row of results) {
		map.set(
			row.account_id,
			row.subaccounts
				.split(',')
				.filter((name) => name.length > 0)
				.sort()
		);
	}

	return map;
}

export async function createAccount(db: DbClient, input: CreateAccountInput): Promise<Account> {
	const id = crypto.randomUUID();

	await db
		.prepare(
			`INSERT INTO accounts (
				id, name, institution, opening_balance_cents, current_balance_cents, display_order
			) VALUES (?, ?, ?, ?, ?, ?)`
		)
		.bind(
			id,
			input.name,
			input.institution ?? null,
			input.openingBalanceCents ?? 0,
			input.currentBalanceCents ?? null,
			input.displayOrder ?? 0
		)
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
				opening_balance_cents = ?,
				current_balance_cents = ?,
				display_order = ?,
				updated_at = CURRENT_TIMESTAMP
			WHERE id = ?`
		)
		.bind(
			input.name ?? existing.name,
			input.institution === undefined ? existing.institution : input.institution,
			input.openingBalanceCents ?? existing.openingBalanceCents,
			input.currentBalanceCents === undefined
				? existing.currentBalanceCents
				: input.currentBalanceCents,
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
			`SELECT id, name, institution, currency, opening_balance_cents, current_balance_cents,
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
	opening_balance_cents: number;
	current_balance_cents: number | null;
	display_order: number;
	created_at: string;
	updated_at: string;
}

interface AccountRowWithBalance extends DbRow {
	account_id: string;
	account_name: string;
	institution: string | null;
	currency: 'EUR';
	opening_balance_cents: number;
	current_balance_cents: number | null;
	balance_cents: number;
	display_order: number;
	account_created_at: string;
	account_updated_at: string;
}

interface SubaccountRow extends DbRow {
	account_id: string;
	subaccounts: string;
}

function mapAccount(row: AccountRow): Account {
	return {
		id: row.id,
		name: row.name,
		institution: row.institution,
		currency: row.currency,
		openingBalanceCents: row.opening_balance_cents,
		currentBalanceCents: row.current_balance_cents,
		displayOrder: row.display_order,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

function mapAccountWithBalance(row: AccountRowWithBalance, subaccounts: string[]): AccountWithBalance {
	return {
		id: row.account_id,
		name: row.account_name,
		institution: row.institution,
		currency: row.currency,
		openingBalanceCents: row.opening_balance_cents,
		currentBalanceCents: row.current_balance_cents,
		balanceCents: row.balance_cents,
		displayOrder: row.display_order,
		createdAt: row.account_created_at,
		updatedAt: row.account_updated_at,
		subaccounts
	};
}
