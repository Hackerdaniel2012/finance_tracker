import { describe, expect, it } from 'vitest';
import {
	applyMigrations,
	createTestDatabase,
	createTestDbClient
} from '../../../../tests/db/test-database';
import { createPlan } from '../plans/repository';
import { getUpcomingPayments } from './repository';

describe('plan cashflow expansion', () => {
	it('preserves a month-end anchor while expanding a forecast window', async () => {
		const database = await createTestDatabase();
		await applyMigrations(database);
		const db = createTestDbClient(database);
		await createPlan(db, {
			direction: 'expense',
			cadence: 'monthly',
			amountCents: 1000,
			nextDate: '2026-01-31',
			counterparty: 'Month end'
		});

		const payments = await getUpcomingPayments(db, {
			asOf: '2026-02-01',
			monthEnd: '2026-03-31',
			nextIncomeDate: null
		});

		expect(payments.map((payment) => payment.dueDate)).toEqual(['2026-02-28', '2026-03-31']);
	});

	it('does not forecast occurrences after a plan end date', async () => {
		const database = await createTestDatabase();
		await applyMigrations(database);
		const db = createTestDbClient(database);
		await createPlan(db, {
			direction: 'expense',
			cadence: 'monthly',
			amountCents: 1000,
			nextDate: '2026-01-31',
			endDate: '2026-02-28'
		});

		const payments = await getUpcomingPayments(db, {
			asOf: '2026-02-01',
			monthEnd: '2026-03-31',
			nextIncomeDate: null
		});

		expect(payments.map((payment) => payment.dueDate)).toEqual(['2026-02-28']);
	});
});
