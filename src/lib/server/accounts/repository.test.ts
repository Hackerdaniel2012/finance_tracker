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
			institution: 'DKB'
		});

		expect(account).toMatchObject({
			name: 'Main Giro',
			institution: 'DKB',
			currency: 'EUR'
		});

		await expect(listAccounts(db)).resolves.toMatchObject([{ id: account.id }]);

		const updated = await updateAccount(db, {
			id: account.id,
			name: 'Household Giro'
		});

		expect(updated).toMatchObject({
			id: account.id,
			name: 'Household Giro'
		});
	});

	it('rejects account updates for unknown ids', async () => {
		await expect(updateAccount(db, { id: 'missing', name: 'Nope' })).rejects.toBeInstanceOf(
			NotFoundError
		);
	});

});

describe('account validation', () => {
	it('parses valid account payloads', () => {
		expect(parseCreateAccountInput({ name: ' Main ' })).toEqual({
			name: 'Main',
			institution: undefined,
			displayOrder: 0
		});
		expect(parseUpdateAccountInput({ id: 'account-1', institution: null })).toEqual({
			id: 'account-1',
			institution: null
		});
	});

	it('rejects malformed payloads', () => {
		expect(() => parseCreateAccountInput({ name: '' })).toThrow(ValidationError);
		expect(() => parseCreateAccountInput({ name: 'Main', currentBalanceCents: 100 })).toThrow(
			'Account balances must be initialized through an import'
		);
		expect(() => parseUpdateAccountInput({ id: 'account-1' })).toThrow(ValidationError);
	});
});
