import { beforeEach, describe, expect, it } from 'vitest';
import {
	applyMigrations,
	createTestDatabase,
	createTestDbClient
} from '../../../../tests/db/test-database';
import { createAccount, createProfile } from '../accounts/repository';
import { createContract } from '../contracts/repository';
import type { DbClient } from '../db-client';
import { createPlannedIncome, createPlannedPayment } from '../planned-cashflow/repository';
import {
	getBalanceBeforeSalaryProjection,
	getMonthCashflowReport,
	getUpcomingIncome,
	getUpcomingPayments
} from './repository';

let db: DbClient;

beforeEach(async () => {
	const sqlite = await createTestDatabase();
	await applyMigrations(sqlite);
	db = createTestDbClient(sqlite);
});

describe('cashflow repository', () => {
	it('combines month-to-date actuals with the remaining forecast', async () => {
		const account = await createAccount(db, { name: 'Main Giro' });
		const other = await createAccount(db, { name: 'Savings' });
		const profile = await createProfile(db, {
			accountId: account.id,
			bankId: 'dkb',
			label: 'Main CSV'
		});
		const otherProfile = await createProfile(db, {
			accountId: other.id,
			bankId: 'n26',
			label: 'Savings CSV'
		});
		await insertTransaction(profile.id, account.id, 'before-month', '2026-06-30', 99999);
		await insertTransaction(profile.id, account.id, 'income', '2026-07-02', 200000);
		await insertTransaction(profile.id, account.id, 'expense', '2026-07-08', -45000);
		await insertTransaction(profile.id, account.id, 'future', '2026-07-09', -10000);
		await insertTransaction(otherProfile.id, other.id, 'other-income', '2026-07-03', 30000);
		await createPlannedPayment(db, {
			accountId: account.id,
			payee: 'Rent',
			amountCents: 80000,
			dueDate: '2026-07-20'
		});
		await createPlannedIncome(db, {
			accountId: account.id,
			payer: 'Employer',
			amountCents: 250000,
			dueDate: '2026-07-25'
		});

		await expect(
			getMonthCashflowReport(db, {
				asOf: '2026-07-08',
				monthEnd: '2026-07-31',
				nextSalaryDate: null,
				accountId: account.id
			})
		).resolves.toMatchObject({
			range: { from: '2026-07-01', asOf: '2026-07-08', to: '2026-07-31' },
			actual: { incomeCents: 200000, expenseCents: -45000, netCents: 155000 },
			forecast: { incomeCents: 250000, paymentCents: 80000, netCents: 170000 },
			projectedNetCents: 325000,
			upcomingPayments: [expect.objectContaining({ payee: 'Rent' })],
			upcomingIncome: [expect.objectContaining({ payer: 'Employer' })]
		});
	});

	it('returns zero actuals and forecast for an empty month', async () => {
		await expect(
			getMonthCashflowReport(db, {
				asOf: '2026-07-08',
				monthEnd: '2026-07-31',
				nextSalaryDate: null
			})
		).resolves.toMatchObject({
			actual: { incomeCents: 0, expenseCents: 0, netCents: 0 },
			forecast: { incomeCents: 0, paymentCents: 0, netCents: 0 },
			projectedNetCents: 0,
			upcomingPayments: [],
			upcomingIncome: []
		});
	});

	it('includes planned, contract, and recurring items in the month forecast', async () => {
		await seedCashflow();

		await expect(
			getMonthCashflowReport(db, {
				asOf: '2026-07-08',
				monthEnd: '2026-07-31',
				nextSalaryDate: null
			})
		).resolves.toMatchObject({
			forecast: { incomeCents: 525000, paymentCents: 95499, netCents: 429501 },
			projectedNetCents: 429501
		});
	});

	it('lists current-month upcoming payments and income', async () => {
		await seedCashflow();

		await expect(
			getUpcomingPayments(db, { asOf: '2026-07-08', monthEnd: '2026-07-31', nextSalaryDate: null })
		).resolves.toEqual([
			expect.objectContaining({ payee: 'Power Co', amountCents: 9000, dueDate: '2026-07-10' }),
			expect.objectContaining({ payee: 'Insurance Co', amountCents: 4500, dueDate: '2026-07-12' }),
			expect.objectContaining({ payee: 'Gym', amountCents: 1999, dueDate: '2026-07-15' }),
			expect.objectContaining({ payee: 'Rent', amountCents: 80000, dueDate: '2026-07-20' })
		]);
		await expect(
			getUpcomingIncome(db, { asOf: '2026-07-08', monthEnd: '2026-07-31', nextSalaryDate: null })
		).resolves.toEqual([
			expect.objectContaining({
				payer: 'Payroll GmbH',
				amountCents: 275000,
				dueDate: '2026-07-24'
			}),
			expect.objectContaining({ payer: 'Employer', amountCents: 250000, dueDate: '2026-07-25' })
		]);
	});

	it('expands confirmed recurring payments from stale next dates by cadence', async () => {
		const account = await createAccount(db, {
			name: 'Main Giro',
			currentBalanceCents: 150000
		});
		await insertRecurringPayment({
			id: 'recurring-rent',
			accountId: account.id,
			categoryId: 'cat-housing',
			payee: 'Rent',
			cadence: 'monthly',
			expectedAmountCents: 80000,
			nextDate: '2026-05-20'
		});
		await insertRecurringPayment({
			id: 'recurring-meal-plan',
			accountId: account.id,
			categoryId: 'cat-groceries',
			payee: 'Meal Plan',
			cadence: 'weekly',
			expectedAmountCents: 1200,
			nextDate: '2026-06-24'
		});

		const payments = await getUpcomingPayments(db, {
			asOf: '2026-07-08',
			monthEnd: '2026-07-31',
			nextSalaryDate: null
		});

		expect(payments).toEqual([
			expect.objectContaining({
				id: 'recurring-meal-plan:2026-07-08',
				payee: 'Meal Plan',
				amountCents: 1200,
				dueDate: '2026-07-08'
			}),
			expect.objectContaining({
				id: 'recurring-meal-plan:2026-07-15',
				payee: 'Meal Plan',
				amountCents: 1200,
				dueDate: '2026-07-15'
			}),
			expect.objectContaining({
				id: 'recurring-rent:2026-07-20',
				payee: 'Rent',
				amountCents: 80000,
				dueDate: '2026-07-20'
			}),
			expect.objectContaining({
				id: 'recurring-meal-plan:2026-07-22',
				payee: 'Meal Plan',
				amountCents: 1200,
				dueDate: '2026-07-22'
			}),
			expect.objectContaining({
				id: 'recurring-meal-plan:2026-07-29',
				payee: 'Meal Plan',
				amountCents: 1200,
				dueDate: '2026-07-29'
			})
		]);
	});

	it('projects balance before the next salary date', async () => {
		await seedCashflow();

		const projection = await getBalanceBeforeSalaryProjection(db, {
			asOf: '2026-07-08',
			monthEnd: '2026-07-31',
			nextSalaryDate: null
		});

		expect(projection).toMatchObject({
			asOf: '2026-07-08',
			projectionDate: '2026-07-23',
			manualNextSalaryDate: null,
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
			monthEnd: '2026-07-31',
			nextSalaryDate: null
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
			monthEnd: '2026-07-31',
			nextSalaryDate: null
		});

		expect(projection).toMatchObject({
			projectionDate: '2026-07-31',
			nextIncome: null,
			currentBalanceCents: 50000,
			upcomingPaymentCents: 9000,
			projectedBalanceCents: 41000
		});
	});

	it('uses an explicit manual next salary date before inferred income', async () => {
		await seedCashflow();

		const projection = await getBalanceBeforeSalaryProjection(db, {
			asOf: '2026-07-08',
			monthEnd: '2026-07-31',
			nextSalaryDate: '2026-07-18'
		});

		expect(projection).toMatchObject({
			projectionDate: '2026-07-17',
			manualNextSalaryDate: '2026-07-18',
			nextIncome: { payer: 'Payroll GmbH', dueDate: '2026-07-24' },
			upcomingPaymentCents: 15499,
			projectedBalanceCents: 134501
		});
		expect(projection.upcomingPayments.map((payment) => payment.payee)).toEqual([
			'Power Co',
			'Insurance Co',
			'Gym'
		]);
	});

	it('includes recurring cadence occurrences in balance-before-salary projections', async () => {
		const account = await createAccount(db, {
			name: 'Main Giro',
			currentBalanceCents: 150000
		});
		await createContract(db, {
			accountId: account.id,
			name: 'Salary',
			payee: 'Employer',
			kind: 'salary',
			cadence: 'monthly',
			expectedAmountCents: 250000,
			nextDate: '2026-07-25'
		});
		await insertRecurringPayment({
			id: 'recurring-weekly',
			accountId: account.id,
			payee: 'Weekly Box',
			cadence: 'weekly',
			expectedAmountCents: 2000,
			nextDate: '2026-06-26'
		});

		const projection = await getBalanceBeforeSalaryProjection(db, {
			asOf: '2026-07-08',
			monthEnd: '2026-07-31',
			nextSalaryDate: null
		});

		expect(projection).toMatchObject({
			projectionDate: '2026-07-24',
			currentBalanceCents: 150000,
			upcomingPaymentCents: 6000,
			projectedBalanceCents: 144000
		});
		expect(projection.upcomingPayments.map((payment) => payment.dueDate)).toEqual([
			'2026-07-10',
			'2026-07-17',
			'2026-07-24'
		]);
		expect(projection.accountProjections).toEqual([
			expect.objectContaining({
				accountName: 'Main Giro',
				upcomingPaymentCents: 6000,
				projectedBalanceCents: 144000
			})
		]);
	});

	it('filters upcoming payments by account', async () => {
		const main = await createAccount(db, { name: 'Main Giro' });
		const savings = await createAccount(db, { name: 'Savings' });
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

		const payments = await getUpcomingPayments(db, {
			asOf: '2026-07-08',
			monthEnd: '2026-07-31',
			nextSalaryDate: null,
			accountId: main.id
		});

		expect(payments).toEqual([expect.objectContaining({ payee: 'Rent', accountId: main.id })]);
	});

	it('filters upcoming income by account', async () => {
		const main = await createAccount(db, { name: 'Main Giro' });
		const savings = await createAccount(db, { name: 'Savings' });
		await createPlannedIncome(db, {
			accountId: main.id,
			payer: 'Employer',
			amountCents: 250000,
			dueDate: '2026-07-25'
		});
		await createPlannedIncome(db, {
			accountId: savings.id,
			payer: 'Side hustle',
			amountCents: 50000,
			dueDate: '2026-07-26'
		});

		const income = await getUpcomingIncome(db, {
			asOf: '2026-07-08',
			monthEnd: '2026-07-31',
			nextSalaryDate: null,
			accountId: savings.id
		});

		expect(income).toEqual([
			expect.objectContaining({ payer: 'Side hustle', accountId: savings.id })
		]);
	});

	it('scopes month cashflow actuals by subaccount', async () => {
		const account = await createAccount(db, { name: 'Main Giro' });
		const profile = await createProfile(db, {
			accountId: account.id,
			bankId: 'n26',
			label: 'Main CSV'
		});
		await insertTransaction(profile.id, account.id, 'main-income', '2026-07-02', 200000, 'Main');
		await insertTransaction(profile.id, account.id, 'main-expense', '2026-07-08', -45000, 'Main');
		await insertTransaction(profile.id, account.id, 'sub-income', '2026-07-03', 50000, 'Side');

		const all = await getMonthCashflowReport(db, {
			asOf: '2026-07-08',
			monthEnd: '2026-07-31',
			nextSalaryDate: null,
			accountId: account.id
		});
		expect(all.actual).toMatchObject({
			incomeCents: 250000,
			expenseCents: -45000,
			netCents: 205000
		});

		const scoped = await getMonthCashflowReport(db, {
			asOf: '2026-07-08',
			monthEnd: '2026-07-31',
			nextSalaryDate: null,
			accountId: account.id,
			subaccount: 'Side'
		});
		expect(scoped.actual).toMatchObject({
			incomeCents: 50000,
			expenseCents: 0,
			netCents: 50000
		});
	});

	it('scopes balance-before-salary current balance by subaccount', async () => {
		const account = await createAccount(db, {
			name: 'Main Giro',
			currentBalanceCents: 150000
		});
		const profile = await createProfile(db, {
			accountId: account.id,
			bankId: 'n26',
			label: 'Main CSV'
		});
		await insertTransaction(profile.id, account.id, 'main-debit', '2026-07-01', -20000, 'Main');
		await insertTransaction(profile.id, account.id, 'side-debit', '2026-07-02', -10000, 'Side');

		const all = await getBalanceBeforeSalaryProjection(db, {
			asOf: '2026-07-08',
			monthEnd: '2026-07-31',
			nextSalaryDate: null,
			accountId: account.id
		});
		expect(all.currentBalanceCents).toBe(150000);

		const scoped = await getBalanceBeforeSalaryProjection(db, {
			asOf: '2026-07-08',
			monthEnd: '2026-07-31',
			nextSalaryDate: null,
			accountId: account.id,
			subaccount: 'Side'
		});
		expect(scoped.currentBalanceCents).toBe(-10000);
	});

	it('filters balance-before-salary projection by account', async () => {
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
			monthEnd: '2026-07-31',
			nextSalaryDate: null,
			accountId: savings.id
		});

		expect(projection).toMatchObject({
			currentBalanceCents: 70000,
			upcomingPaymentCents: 20000,
			projectedBalanceCents: 50000,
			nextIncome: null
		});
		expect(projection.upcomingPayments.map((payment) => payment.payee)).toEqual(['Insurance']);
		expect(projection.accountProjections).toEqual([
			expect.objectContaining({
				accountName: 'Savings',
				currentBalanceCents: 70000,
				upcomingPaymentCents: 20000,
				projectedBalanceCents: 50000
			})
		]);
	});
});

async function insertTransaction(
	profileId: string,
	accountId: string,
	id: string,
	bookingDate: string,
	amountCents: number,
	subaccount?: string
) {
	await db
		.prepare(
			`INSERT INTO transactions (
				id, profile_id, account_id, dedupe_key, booking_date, amount_cents, subaccount, search_text
			) VALUES (?, ?, ?, ?, ?, ?, ?, '')`
		)
		.bind(id, profileId, accountId, id, bookingDate, amountCents, subaccount ?? null)
		.run();
}

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
	await createContract(db, {
		accountId: account.id,
		categoryId: 'cat-salary',
		name: 'Salary',
		payee: 'Employer',
		kind: 'salary',
		cadence: 'monthly',
		expectedAmountCents: 250000,
		nextDate: '2026-07-25'
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

async function insertRecurringPayment(input: {
	id: string;
	accountId: string;
	categoryId?: string | null;
	payee: string;
	cadence: 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';
	expectedAmountCents: number;
	nextDate: string;
}) {
	await db
		.prepare(
			`INSERT INTO recurring_groups (
				id, account_id, category_id, payee, cadence, expected_amount_cents,
				next_date, status, confidence
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			input.id,
			input.accountId,
			input.categoryId ?? null,
			input.payee,
			input.cadence,
			input.expectedAmountCents,
			input.nextDate,
			'confirmed',
			90
		)
		.run();
}
