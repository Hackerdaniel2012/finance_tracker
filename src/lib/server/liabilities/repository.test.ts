import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	applySql,
	createTestDatabase,
	createTestDbClient,
	firstValue
} from '../../../../tests/db/test-database';
import { createAccount } from '../accounts/repository';
import type { DbClient } from '../db-client';
import { createLiability, deleteLiability, listLiabilities, updateLiability } from './repository';

let db: DbClient;
let sqlite: Awaited<ReturnType<typeof createTestDatabase>>;

beforeEach(async () => {
	sqlite = await createTestDatabase();
	applySql(sqlite, await readFile(resolve('migrations/0001_initial_schema.sql'), 'utf8'));
	applySql(sqlite, await readFile(resolve('migrations/0002_seed_default_categories.sql'), 'utf8'));
	db = createTestDbClient(sqlite);
});

describe('liability repository', () => {
	it('creates, lists, updates, and deletes liabilities', async () => {
		const account = await createAccount(db, { name: 'Main Giro' });
		const created = await createLiability(db, {
			accountId: account.id,
			name: 'Credit Card',
			amountCents: 125000,
			asOfDate: '2026-07-08',
			note: 'July balance'
		});

		expect(created).toMatchObject({
			accountId: account.id,
			accountName: 'Main Giro',
			name: 'Credit Card',
			amountCents: 125000,
			asOfDate: '2026-07-08',
			status: 'active',
			note: 'July balance'
		});
		await expect(listLiabilities(db)).resolves.toHaveLength(1);

		const updated = await updateLiability(db, {
			id: created.id,
			accountId: null,
			amountCents: 100000,
			status: 'cleared',
			note: null
		});

		expect(updated).toMatchObject({
			id: created.id,
			accountId: null,
			accountName: null,
			amountCents: 100000,
			status: 'cleared',
			note: null
		});

		await deleteLiability(db, created.id);
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM marked_liabilities')).toBe(0);
	});

	it('returns not found errors for missing accounts and liabilities', async () => {
		await expect(
			createLiability(db, {
				accountId: 'missing',
				name: 'Loan',
				amountCents: 1000,
				asOfDate: '2026-07-08'
			})
		).rejects.toThrow('Account not found');
		await expect(updateLiability(db, { id: 'missing', name: 'Nope' })).rejects.toThrow(
			'Liability not found'
		);
		await expect(deleteLiability(db, 'missing')).rejects.toThrow('Liability not found');
	});
});
