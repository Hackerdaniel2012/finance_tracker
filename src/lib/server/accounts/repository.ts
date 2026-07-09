import type { BankId } from '$lib/banks';
import type { DbClient, DbRow } from '../db-client';
import { ConflictError, NotFoundError } from './errors';
import type {
	Account,
	AccountWithProfile,
	CreateAccountInput,
	CreateProfileInput,
	ImportProfile,
	UpdateAccountInput
} from './types';

export async function listAccounts(db: DbClient): Promise<AccountWithProfile[]> {
	const { results } = await db
		.prepare(
			`SELECT
				a.id AS account_id,
				a.name AS account_name,
				a.institution,
				a.currency,
				a.opening_balance_cents,
				a.current_balance_cents,
				a.display_order,
				a.created_at AS account_created_at,
				a.updated_at AS account_updated_at,
				p.id AS profile_id,
				p.account_id AS profile_account_id,
				p.bank_id,
				p.label,
				p.status,
				p.created_at AS profile_created_at,
				p.updated_at AS profile_updated_at
			FROM accounts a
			LEFT JOIN import_profiles p ON p.account_id = a.id
			ORDER BY a.display_order ASC, a.created_at ASC`
		)
		.all<AccountProfileRow>();

	return results.map(mapAccountWithProfile);
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

export async function listProfiles(db: DbClient): Promise<ImportProfile[]> {
	const { results } = await db
		.prepare(
			`SELECT id, account_id, bank_id, label, status, created_at, updated_at
			FROM import_profiles
			ORDER BY created_at ASC`
		)
		.all<ProfileRow>();

	return results.map(mapProfile);
}

export async function createProfile(
	db: DbClient,
	input: CreateProfileInput
): Promise<ImportProfile> {
	const account = await getAccount(db, input.accountId);
	if (!account) {
		throw new NotFoundError('Account not found');
	}

	const existing = await getProfileByAccountId(db, input.accountId);
	if (existing) {
		throw new ConflictError('Account already has an import profile');
	}

	const id = crypto.randomUUID();
	await db
		.prepare(
			`INSERT INTO import_profiles (id, account_id, bank_id, label)
			VALUES (?, ?, ?, ?)`
		)
		.bind(id, input.accountId, input.bankId, input.label)
		.run();

	const profile = await getProfile(db, id);
	if (!profile) {
		throw new NotFoundError('Created import profile could not be loaded');
	}

	return profile;
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

export async function getProfile(db: DbClient, id: string): Promise<ImportProfile | null> {
	const row = await db
		.prepare(
			`SELECT id, account_id, bank_id, label, status, created_at, updated_at
			FROM import_profiles
			WHERE id = ?`
		)
		.bind(id)
		.first<ProfileRow>();

	return row ? mapProfile(row) : null;
}

async function getProfileByAccountId(
	db: DbClient,
	accountId: string
): Promise<ImportProfile | null> {
	const row = await db
		.prepare(
			`SELECT id, account_id, bank_id, label, status, created_at, updated_at
			FROM import_profiles
			WHERE account_id = ?`
		)
		.bind(accountId)
		.first<ProfileRow>();

	return row ? mapProfile(row) : null;
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

interface ProfileRow extends DbRow {
	id: string;
	account_id: string;
	bank_id: BankId;
	label: string;
	status: 'active' | 'archived';
	created_at: string;
	updated_at: string;
}

interface AccountProfileRow extends DbRow {
	account_id: string;
	account_name: string;
	institution: string | null;
	currency: 'EUR';
	opening_balance_cents: number;
	current_balance_cents: number | null;
	display_order: number;
	account_created_at: string;
	account_updated_at: string;
	profile_id: string | null;
	profile_account_id: string | null;
	bank_id: BankId | null;
	label: string | null;
	status: 'active' | 'archived' | null;
	profile_created_at: string | null;
	profile_updated_at: string | null;
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

function mapProfile(row: ProfileRow): ImportProfile {
	return {
		id: row.id,
		accountId: row.account_id,
		bankId: row.bank_id,
		label: row.label,
		status: row.status,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

function mapAccountWithProfile(row: AccountProfileRow): AccountWithProfile {
	return {
		id: row.account_id,
		name: row.account_name,
		institution: row.institution,
		currency: row.currency,
		openingBalanceCents: row.opening_balance_cents,
		currentBalanceCents: row.current_balance_cents,
		displayOrder: row.display_order,
		createdAt: row.account_created_at,
		updatedAt: row.account_updated_at,
		profile:
			row.profile_id && row.profile_account_id && row.bank_id && row.label && row.status
				? {
						id: row.profile_id,
						accountId: row.profile_account_id,
						bankId: row.bank_id,
						label: row.label,
						status: row.status,
						createdAt: row.profile_created_at ?? '',
						updatedAt: row.profile_updated_at ?? ''
					}
				: null
	};
}
