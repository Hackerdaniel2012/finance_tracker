import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	applySql,
	createTestDatabase,
	createTestDbClient
} from '../../../../tests/db/test-database';
import { createAccount } from '../accounts/repository';
import { createContract } from '../contracts/repository';
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
			expect.objectContaining({ payee: 'Insurance Co', amountCents: 4500, dueDate: '2026-07-12' }),
			expect.objectContaining({ payee: 'Gym', amountCents: 1999, dueDate: '2026-07-15' }),
			expect.objectContaining({ payee: 'Rent', amountCents: 80000, dueDate: '2026-07-20' })
		]);
		await expect(
			getUpcomingIncome(db, { asOf: '2026-07-08', monthEnd: '2026-07-31' })
		).resolves.toEqual([
			expect.objectContaining({
				payer: 'Payroll GmbH',
				amountCents: 275000,
				dueDate: '2026-07-24'
			}),
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
			projectionDate: '2026-07-23',
			currentBalanceCents: 150000,
			upcomingPaymentCents: 95499,
			projectedBalanceCents: 54501,
			nextIncome: { payer: 'Payroll GmbH', dueDate: '2026-07-24' }
		});
		expect(projection.upcomingPayments.map((payment) => payment.payee)).toEqual([
			'Power Co',
			'Insurance Co',
			'Gym',
			'Rent'
		]);
		expect(projection.accountProjections).toEqual([
			expect.objectContaining({
				accountName: 'Main Giro',
				currentBalanceCents: 150000,
				upcomingPaymentCents: 95499,
				projectedBalanceCents: 54501
			})
		]);
	});

	it('includes per-account balance before salary projections', async () => {
		const main = await createAccount(db, {
			name: 'Main Giro',
			currentBalanceCents: 150000
		});
		const savings = await createAccount(db, {
			name: 'Savings',
			currentBalanceCents: 70000
		});
		await createPlannedPayment(db, {
			accountId: main.id,
			payee: 'Rent',
			amountCents: 80000,
			dueDate: '2026-07-20'
		});
		await createPlannedPayment(db, {
			accountId: savings.id,
			payee: 'Insurance',
			amountCents: 20000,
			dueDate: '2026-07-21'
		});
		await createPlannedIncome(db, {
			accountId: main.id,
			payer: 'Employer',
			amountCents: 250000,
			dueDate: '2026-07-25'
		});

		const projection = await getBalanceBeforeSalaryProjection(db, {
			asOf: '2026-07-08',
			monthEnd: '2026-07-31'
		});

		expect(projection).toMatchObject({
			currentBalanceCents: 220000,
			upcomingPaymentCents: 100000,
			projectedBalanceCents: 120000
		});
		expect(projection.accountProjections).toEqual([
			expect.objectContaining({
				accountName: 'Main Giro',
				currentBalanceCents: 150000,
				upcomingPaymentCents: 80000,
				projectedBalanceCents: 70000
			}),
			expect.objectContaining({
				accountName: 'Savings',
				currentBalanceCents: 70000,
				upcomingPaymentCents: 20000,
				projectedBalanceCents: 50000
			})
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
	await createContract(db, {
		accountId: account.id,
		categoryId: 'cat-utilities',
		name: 'Insurance',
		payee: 'Insurance Co',
		kind: 'fixed_cost',
		cadence: 'monthly',
		expectedAmountCents: 4500,
		nextDate: '2026-07-12'
	});
	await createContract(db, {
		accountId: account.id,
		categoryId: 'cat-salary',
		name: 'Salary',
		payee: 'Payroll GmbH',
		kind: 'salary',
		cadence: 'monthly',
		expectedAmountCents: 275000,
		nextDate: '2026-07-24'
	});
	await db
		.prepare(
			`INSERT INTO recurring_groups (
				id, account_id, category_id, payee, cadence, expected_amount_cents,
				next_date, status, confidence
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			'recurring-gym',
			account.id,
			'cat-health',
			'Gym',
			'monthly',
			1999,
			'2026-07-15',
			'confirmed',
			90
		)
		.run();
	await db
		.prepare(
			`INSERT INTO recurring_groups (
				id, account_id, category_id, payee, cadence, expected_amount_cents,
				next_date, status, confidence
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			'recurring-suggestion',
			account.id,
			'cat-health',
			'Suggested Gym',
			'monthly',
			1999,
			'2026-07-16',
			'suggested',
			90
		)
		.run();
}
