import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	applySql,
	createTestDatabase,
	createTestDbClient
} from '../../../../tests/db/test-database';
import { createAccount } from '../accounts/repository';
import type { DbClient } from '../db-client';
import { createPlannedIncome, createPlannedPayment } from '../planned-cashflow/repository';
import {
	getBalanceBeforeSalaryProjection,
	getUpcomingIncome,
	getUpcomingPayments
} from './repository';

let db: DbClient;

beforeEach(async () => {
	const sqlite = await createTestDatabase();
	applySql(sqlite, await readFile(resolve('migrations/0001_initial_schema.sql'), 'utf8'));
	applySql(sqlite, await readFile(resolve('migrations/0002_seed_default_categories.sql'), 'utf8'));
	db = createTestDbClient(sqlite);
});

describe('cashflow repository', () => {
	it('lists current-month upcoming payments and income', async () => {
		await seedCashflow();

		await expect(
			getUpcomingPayments(db, { asOf: '2026-07-08', monthEnd: '2026-07-31' })
		).resolves.toEqual([
			expect.objectContaining({ payee: 'Power Co', amountCents: 9000, dueDate: '2026-07-10' }),
			expect.objectContaining({ payee: 'Rent', amountCents: 80000, dueDate: '2026-07-20' })
		]);
		await expect(
			getUpcomingIncome(db, { asOf: '2026-07-08', monthEnd: '2026-07-31' })
		).resolves.toEqual([
			expect.objectContaining({ payer: 'Employer', amountCents: 250000, dueDate: '2026-07-25' })
		]);
	});

	it('projects balance before the next salary date', async () => {
		await seedCashflow();

		const projection = await getBalanceBeforeSalaryProjection(db, {
			asOf: '2026-07-08',
			monthEnd: '2026-07-31'
		});

		expect(projection).toMatchObject({
			asOf: '2026-07-08',
			projectionDate: '2026-07-24',
			currentBalanceCents: 150000,
			upcomingPaymentCents: 89000,
			projectedBalanceCents: 61000,
			nextIncome: { payer: 'Employer', dueDate: '2026-07-25' }
		});
		expect(projection.upcomingPayments.map((payment) => payment.payee)).toEqual([
			'Power Co',
			'Rent'
		]);
	});

	it('projects to month end when there is no upcoming income', async () => {
		const account = await createAccount(db, {
			name: 'Main Giro',
			currentBalanceCents: 50000
		});
		await createPlannedPayment(db, {
			accountId: account.id,
			payee: 'Power Co',
			amountCents: 9000,
			dueDate: '2026-07-10'
		});

		const projection = await getBalanceBeforeSalaryProjection(db, {
			asOf: '2026-07-08',
			monthEnd: '2026-07-31'
		});

		expect(projection).toMatchObject({
			projectionDate: '2026-07-31',
			nextIncome: null,
			currentBalanceCents: 50000,
			upcomingPaymentCents: 9000,
			projectedBalanceCents: 41000
		});
	});
});

async function seedCashflow() {
	const account = await createAccount(db, {
		name: 'Main Giro',
		currentBalanceCents: 150000
	});
	await createPlannedPayment(db, {
		accountId: account.id,
		categoryId: 'cat-utilities',
		payee: 'Power Co',
		amountCents: 9000,
		dueDate: '2026-07-10'
	});
	await createPlannedPayment(db, {
		accountId: account.id,
		categoryId: 'cat-housing',
		payee: 'Rent',
		amountCents: 80000,
		dueDate: '2026-07-20'
	});
	await createPlannedPayment(db, {
		accountId: account.id,
		payee: 'Next month',
		amountCents: 1000,
		dueDate: '2026-08-01'
	});
	await createPlannedIncome(db, {
		accountId: account.id,
		categoryId: 'cat-salary',
		payer: 'Employer',
		amountCents: 250000,
		dueDate: '2026-07-25'
	});
}
