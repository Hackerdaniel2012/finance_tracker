import { beforeEach, describe, expect, it } from 'vitest';
import {
	applyMigrations,
	createTestDatabase,
	createTestDbClient
} from '../../../../tests/db/test-database';
import type { DbClient } from '../db-client';
import { NotFoundError, ValidationError } from './errors';
import { createAccount, listAccounts, updateAccount } from './repository';
import { parseCreateAccountInput, parseUpdateAccountInput } from './validation';

let db: DbClient;

beforeEach(async () => {
	const sqlite = await createTestDatabase();
	await applyMigrations(sqlite);
	db = createTestDbClient(sqlite);
});

describe('account repository', () => {
	it('creates, lists, and updates accounts', async () => {
		const account = await createAccount(db, {
			name: 'Main Giro',
			institution: 'DKB',
			openingBalanceCents: 10000
		});

		expect(account).toMatchObject({
			name: 'Main Giro',
			institution: 'DKB',
			currency: 'EUR',
			openingBalanceCents: 10000,
			currentBalanceCents: null
		});

		await expect(listAccounts(db)).resolves.toMatchObject([{ id: account.id }]);

		const updated = await updateAccount(db, {
			id: account.id,
			name: 'Household Giro',
			currentBalanceCents: 12345
		});

		expect(updated).toMatchObject({
			id: account.id,
			name: 'Household Giro',
			currentBalanceCents: 12345
		});
	});

	it('rejects account updates for unknown ids', async () => {
		await expect(updateAccount(db, { id: 'missing', name: 'Nope' })).rejects.toBeInstanceOf(
			NotFoundError
		);
	});

	it('lists distinct subaccounts for an account from its transactions', async () => {
		const account = await createAccount(db, { name: 'N26' });
		const otherAccount = await createAccount(db, { name: 'DKB' });
		db.prepare(
			`INSERT INTO transactions (
				id, account_id, dedupe_key, booking_date, amount_cents, search_text, subaccount
			) VALUES (?, ?, ?, ?, ?, ?, ?)`
		)
			.bind('txn-1', account.id, 'dedupe-1', '2026-07-08', -100, 'coffee', 'Hauptkonto')
			.run();
		db.prepare(
			`INSERT INTO transactions (
				id, account_id, dedupe_key, booking_date, amount_cents, search_text, subaccount
			) VALUES (?, ?, ?, ?, ?, ?, ?)`
		)
			.bind('txn-2', account.id, 'dedupe-2', '2026-07-09', -200, 'groceries', '20k in 2023')
			.run();
		db.prepare(
			`INSERT INTO transactions (
				id, account_id, dedupe_key, booking_date, amount_cents, search_text, subaccount
			) VALUES (?, ?, ?, ?, ?, ?, ?)`
		)
			.bind('txn-3', account.id, 'dedupe-3', '2026-07-10', -300, 'fuel', 'Hauptkonto')
			.run();

		const accounts = await listAccounts(db);
		const mapped = accounts.map((account) => ({
			id: account.id,
			subaccounts: account.subaccounts
		}));

		expect(mapped).toEqual([
			{ id: account.id, subaccounts: ['20k in 2023', 'Hauptkonto'] },
			{ id: otherAccount.id, subaccounts: [] }
		]);
	});
});

describe('account validation', () => {
	it('parses valid account payloads', () => {
		expect(parseCreateAccountInput({ name: ' Main ', openingBalanceCents: 100 })).toEqual({
			name: 'Main',
			institution: undefined,
			openingBalanceCents: 100,
			currentBalanceCents: undefined,
			displayOrder: 0
		});
		expect(parseUpdateAccountInput({ id: 'account-1', institution: null })).toEqual({
			id: 'account-1',
			institution: null
		});
	});

	it('rejects malformed payloads', () => {
		expect(() => parseCreateAccountInput({ name: '' })).toThrow(ValidationError);
		expect(() => parseUpdateAccountInput({ id: 'account-1' })).toThrow(ValidationError);
	});
});
