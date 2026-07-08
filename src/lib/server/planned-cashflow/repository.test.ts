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
import {
	createPlannedIncome,
	createPlannedPayment,
	deletePlannedIncome,
	deletePlannedPayment,
	listPlannedIncome,
	listPlannedPayments,
	updatePlannedIncome,
	updatePlannedPayment
} from './repository';

let db: DbClient;
let sqlite: Awaited<ReturnType<typeof createTestDatabase>>;

beforeEach(async () => {
	sqlite = await createTestDatabase();
	applySql(sqlite, await readFile(resolve('migrations/0001_initial_schema.sql'), 'utf8'));
	applySql(sqlite, await readFile(resolve('migrations/0002_seed_default_categories.sql'), 'utf8'));
	db = createTestDbClient(sqlite);
});

describe('planned cashflow repository', () => {
	it('creates, lists, updates, and deletes planned payments', async () => {
		const account = await createAccount(db, { name: 'Main Giro' });
		const created = await createPlannedPayment(db, {
			accountId: account.id,
			categoryId: 'cat-utilities',
			payee: 'Power Co',
			amountCents: 8900,
			dueDate: '2026-07-15',
			note: 'Meter estimate'
		});

		expect(created).toMatchObject({
			accountName: 'Main Giro',
			categoryName: 'Utilities',
			payee: 'Power Co',
			status: 'planned'
		});
		await expect(listPlannedPayments(db)).resolves.toHaveLength(1);

		const updated = await updatePlannedPayment(db, {
			id: created.id,
			status: 'paid',
			note: null,
			accountId: null
		});

		expect(updated).toMatchObject({ id: created.id, status: 'paid', note: null, accountId: null });
		await deletePlannedPayment(db, created.id);
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM planned_payments')).toBe(0);
	});

	it('creates, lists, updates, and deletes planned income', async () => {
		const account = await createAccount(db, { name: 'Main Giro' });
		const created = await createPlannedIncome(db, {
			accountId: account.id,
			categoryId: 'cat-salary',
			payer: 'Employer',
			amountCents: 250000,
			dueDate: '2026-07-25'
		});

		expect(created).toMatchObject({
			accountName: 'Main Giro',
			categoryName: 'Salary',
			payer: 'Employer',
			status: 'planned'
		});
		await expect(listPlannedIncome(db)).resolves.toHaveLength(1);

		const updated = await updatePlannedIncome(db, {
			id: created.id,
			status: 'received',
			note: 'Arrived'
		});

		expect(updated).toMatchObject({ id: created.id, status: 'received', note: 'Arrived' });
		await deletePlannedIncome(db, created.id);
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM planned_income')).toBe(0);
	});

	it('returns not found errors for missing links and rows', async () => {
		await expect(
			createPlannedPayment(db, {
				accountId: 'missing',
				payee: 'Power Co',
				amountCents: 1000,
				dueDate: '2026-07-15'
			})
		).rejects.toThrow('Account not found');
		await expect(
			createPlannedIncome(db, {
				categoryId: 'missing',
				payer: 'Employer',
				amountCents: 1000,
				dueDate: '2026-07-25'
			})
		).rejects.toThrow('Category not found');
		await expect(updatePlannedPayment(db, { id: 'missing', payee: 'Nope' })).rejects.toThrow(
			'Planned payment not found'
		);
		await expect(updatePlannedIncome(db, { id: 'missing', payer: 'Nope' })).rejects.toThrow(
			'Planned income not found'
		);
	});
});
