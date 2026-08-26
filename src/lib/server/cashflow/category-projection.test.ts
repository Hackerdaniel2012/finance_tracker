import { beforeEach, describe, expect, it } from 'vitest';
import {
	applyMigrations,
	createTestDatabase,
	createTestDbClient
} from '../../../../tests/db/test-database';
import { createAccount } from '../accounts/repository';
import type { DbClient } from '../db-client';
import { createPlan } from '../plans/repository';
import { getCategoryCostProjection } from './category-projection';

let db: DbClient;

beforeEach(async () => {
	const sqlite = await createTestDatabase();
	await applyMigrations(sqlite);
	db = createTestDbClient(sqlite);
});

describe('category cost projection', () => {
	it('uses the higher of the three-month average and actual plus remaining plans', async () => {
		const account = await createAccount(db, { name: 'Main account' });
		await seedTransaction(account.id, 'groceries-april', '2026-04-10', -6000, 'cat-groceries');
		await seedTransaction(account.id, 'groceries-june', '2026-06-10', -3000, 'cat-groceries');
		await seedTransaction(account.id, 'groceries-current', '2026-07-02', -2000, 'cat-groceries');
		for (const [month, date] of [
			['april', '2026-04-12'],
			['may', '2026-05-12'],
			['june', '2026-06-12']
		] as const) {
			await seedTransaction(account.id, `vehicles-${month}`, date, -6000, 'cat-vehicles');
		}
		await seedTransaction(account.id, 'vehicles-current', '2026-07-03', -2000, 'cat-vehicles');
		await createPlan(db, {
			accountId: account.id,
			categoryId: 'cat-groceries',
			direction: 'expense',
			cadence: 'once',
			amountCents: 1500,
			nextDate: '2026-07-20',
			counterparty: 'Market'
		});
		await createPlan(db, {
			accountId: account.id,
			categoryId: 'cat-vehicles',
			direction: 'expense',
			cadence: 'once',
			amountCents: 1000,
			nextDate: '2026-07-22',
			counterparty: 'Garage'
		});

		const report = await getCategoryCostProjection(db, {
			asOf: '2026-07-10',
			monthEnd: '2026-07-31',
			nextIncomeDate: null,
			accountId: account.id,
			categoryIds: ['cat-groceries', 'cat-vehicles']
		});

		expect(report.range).toEqual({
			from: '2026-07-01',
			asOf: '2026-07-10',
			to: '2026-07-31',
			historyFrom: '2026-04-01',
			historyTo: '2026-06-30',
			historyMonths: ['2026-04', '2026-05', '2026-06']
		});
		expect(report.categories).toEqual([
			expect.objectContaining({
				categoryId: 'cat-groceries',
				actualCents: 2000,
				historicalAverageCents: 3000,
				plannedRemainingCents: 1500,
				committedCents: 3500,
				projectedCents: 3500,
				projectedRemainingCents: 1500
			}),
			expect.objectContaining({
				categoryId: 'cat-vehicles',
				actualCents: 2000,
				historicalAverageCents: 6000,
				plannedRemainingCents: 1000,
				committedCents: 3000,
				projectedCents: 6000,
				projectedRemainingCents: 4000
			})
		]);
		expect(report.totals).toEqual({
			actualCents: 4000,
			historicalAverageCents: 9000,
			plannedRemainingCents: 2500,
			committedCents: 6500,
			projectedCents: 9500,
			projectedRemainingCents: 5500
		});
	});

	it('groups null and explicit Unknown while respecting the account filter', async () => {
		const account = await createAccount(db, { name: 'Selected account' });
		const other = await createAccount(db, { name: 'Other account' });
		await seedTransaction(account.id, 'unknown-april', '2026-04-01', -300, null);
		await seedTransaction(account.id, 'unknown-june', '2026-06-01', -600, 'cat-unknown');
		await seedTransaction(account.id, 'unknown-current-null', '2026-07-02', -500, null);
		await seedTransaction(
			account.id,
			'unknown-current-explicit',
			'2026-07-03',
			-700,
			'cat-unknown'
		);
		await seedTransaction(other.id, 'other-unknown', '2026-07-03', -9000, null);
		await createPlan(db, {
			accountId: account.id,
			categoryId: null,
			direction: 'expense',
			cadence: 'once',
			amountCents: 400,
			nextDate: '2026-07-15'
		});

		const report = await getCategoryCostProjection(db, {
			asOf: '2026-07-10',
			monthEnd: '2026-07-31',
			nextIncomeDate: null,
			accountId: account.id,
			categoryIds: ['cat-unknown']
		});

		expect(report.categories[0]).toEqual(
			expect.objectContaining({
				categoryId: 'cat-unknown',
				actualCents: 1200,
				historicalAverageCents: 300,
				plannedRemainingCents: 400,
				projectedCents: 1600
			})
		);
	});
});

async function seedTransaction(
	accountId: string,
	id: string,
	bookingDate: string,
	amountCents: number,
	categoryId: string | null
) {
	await db
		.prepare(
			`INSERT INTO transactions (
				id, account_id, category_id, dedupe_key, booking_date, amount_cents, search_text
			) VALUES (?, ?, ?, ?, ?, ?, '')`
		)
		.bind(id, accountId, categoryId, id, bookingDate, amountCents)
		.run();
}
