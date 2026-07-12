import { beforeEach, describe, expect, it } from 'vitest';
import {
	applyMigrations,
	createTestDatabase,
	createTestDbClient,
	firstValue
} from '../../../../tests/db/test-database';
import { createAccount } from '../accounts/repository';
import type { DbClient } from '../db-client';
import { createContract, deleteContract, listContracts, updateContract } from './repository';

let db: DbClient;
let sqlite: Awaited<ReturnType<typeof createTestDatabase>>;

beforeEach(async () => {
	sqlite = await createTestDatabase();
	await applyMigrations(sqlite);
	db = createTestDbClient(sqlite);
});

describe('contract repository', () => {
	it('creates, lists, updates, and deletes contracts', async () => {
		const account = await createAccount(db, { name: 'Main Giro' });
		const importAccount = { ...account, accountId: account.id, bankId: 'dkb_girocard' as const };

		const created = await createContract(db, {
			accountId: account.id,
			name: 'Gym',
			payee: 'Fit Co',
			kind: 'subscription',
			cadence: 'monthly',
			expectedAmountCents: 2999,
			nextDate: '2026-07-15'
		});

		expect(created).toMatchObject({
			accountId: account.id,
			accountName: 'Main Giro',
			name: 'Gym',
			payee: 'Fit Co',
			kind: 'subscription',
			cadence: 'monthly',
			expectedAmountCents: 2999,
			nextDate: '2026-07-15',
			status: 'active',
			source: 'manual'
		});
		await expect(listContracts(db)).resolves.toHaveLength(1);

		const updated = await updateContract(db, {
			id: created.id,
			accountId: null,
			payee: null,
			expectedAmountCents: 3499,
			status: 'paused',
			endDate: '2026-12-31'
		});

		expect(updated).toMatchObject({
			id: created.id,
			accountId: null,
			payee: null,
			expectedAmountCents: 3499,
			status: 'paused',
			endDate: '2026-12-31'
		});

		await deleteContract(db, created.id);
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM contracts')).toBe(0);
	});

	it('returns not found errors for missing links and contracts', async () => {
		await expect(
			createContract(db, {
				accountId: 'missing',
				name: 'Rent',
				kind: 'fixed_cost',
				cadence: 'monthly',
				expectedAmountCents: 90000,
				nextDate: '2026-07-31'
			})
		).rejects.toThrow('Account not found');
		await expect(updateContract(db, { id: 'missing', name: 'Nope' })).rejects.toThrow(
			'Contract not found'
		);
		await expect(deleteContract(db, 'missing')).rejects.toThrow('Contract not found');
	});
});
