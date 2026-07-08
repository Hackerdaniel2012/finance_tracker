import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	applySql,
	createTestDatabase,
	createTestDbClient
} from '../../../../tests/db/test-database';
import type { DbClient } from '../db-client';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import {
	createAccount,
	createProfile,
	listAccounts,
	listProfiles,
	updateAccount
} from './repository';
import {
	parseCreateAccountInput,
	parseCreateProfileInput,
	parseUpdateAccountInput
} from './validation';

let db: DbClient;

beforeEach(async () => {
	const sqlite = await createTestDatabase();
	applySql(sqlite, await readFile(resolve('migrations/0001_initial_schema.sql'), 'utf8'));
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

		await expect(listAccounts(db)).resolves.toMatchObject([{ id: account.id, profile: null }]);

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

	it('creates one import profile per account', async () => {
		const account = await createAccount(db, { name: 'Brokerage' });
		const profile = await createProfile(db, {
			accountId: account.id,
			bankId: 'trade_republic',
			label: 'Trade Republic CSV'
		});

		expect(profile).toMatchObject({
			accountId: account.id,
			bankId: 'trade_republic',
			label: 'Trade Republic CSV',
			status: 'active'
		});
		await expect(listProfiles(db)).resolves.toMatchObject([{ id: profile.id }]);
		await expect(listAccounts(db)).resolves.toMatchObject([
			{ id: account.id, profile: { id: profile.id, bankId: 'trade_republic' } }
		]);
		await expect(
			createProfile(db, { accountId: account.id, bankId: 'n26', label: 'Duplicate' })
		).rejects.toBeInstanceOf(ConflictError);
	});

	it('rejects profiles for unknown accounts and account updates for unknown ids', async () => {
		await expect(
			createProfile(db, { accountId: 'missing', bankId: 'dkb', label: 'DKB' })
		).rejects.toBeInstanceOf(NotFoundError);
		await expect(updateAccount(db, { id: 'missing', name: 'Nope' })).rejects.toBeInstanceOf(
			NotFoundError
		);
	});
});

describe('account validation', () => {
	it('parses valid account and profile payloads', () => {
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
		expect(
			parseCreateProfileInput({ accountId: 'account-1', bankId: 'dkb', label: ' DKB ' })
		).toEqual({
			accountId: 'account-1',
			bankId: 'dkb',
			label: 'DKB'
		});
	});

	it('rejects malformed payloads', () => {
		expect(() => parseCreateAccountInput({ name: '' })).toThrow(ValidationError);
		expect(() => parseUpdateAccountInput({ id: 'account-1' })).toThrow(ValidationError);
		expect(() =>
			parseCreateProfileInput({ accountId: 'account-1', bankId: 'unknown', label: 'Bad' })
		).toThrow(ValidationError);
	});
});
