import { beforeEach, describe, expect, it } from 'vitest';
import {
	applyMigrations,
	createTestDatabase,
	createTestDbClient,
	firstValue
} from '../../../../tests/db/test-database';
import { createAccount } from '../accounts/repository';
import type { DbClient } from '../db-client';
import { reconcilePlans } from '../plans/matching';
import { createPlan } from '../plans/repository';
import { projectLiability } from './projection';
import { createLiability, deleteLiability, listLiabilities, updateLiability } from './repository';

let db: DbClient;
let sqlite: Awaited<ReturnType<typeof createTestDatabase>>;

beforeEach(async () => {
	sqlite = await createTestDatabase();
	await applyMigrations(sqlite);
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
			asOfDate: '2026-07-08',
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

	it('includes the linked plan and derives its repayment projection', async () => {
		const account = await createAccount(db, { name: 'Main Giro' });
		const liability = await createLiability(db, {
			accountId: account.id,
			name: 'Vehicle loan',
			amountCents: 100000,
			asOfDate: '2026-07-12',
			annualInterestRateBps: 0
		});
		const plan = await createPlan(db, {
			accountId: account.id,
			categoryId: 'cat-installment-plan',
			label: 'Car installment',
			counterparty: 'Auto Bank',
			direction: 'expense',
			cadence: 'monthly',
			amountCents: 10000,
			nextDate: '2026-07-15',
			liabilityId: liability.id
		});

		await expect(listLiabilities(db)).resolves.toMatchObject([
			{
				id: liability.id,
				plan: {
					id: plan.id,
					label: 'Car installment',
					counterparty: 'Auto Bank',
					categoryName: 'Installment plan',
					cadence: 'monthly',
					amountCents: 10000,
					nextDate: '2026-07-15'
				},
				projection: {
					nextInterestCents: 0,
					nextPrincipalCents: 10000,
					estimatedRemainingPayments: 10,
					estimatedPayoffDate: '2027-04-15',
					estimatedRemainingInterestCents: 0
				}
			}
		]);
	});

	it('rejects clearing the interest rate of a liability linked to a plan', async () => {
		const account = await createAccount(db, { name: 'Main Giro' });
		const liability = await createLiability(db, {
			accountId: account.id,
			name: 'Vehicle loan',
			amountCents: 100000,
			asOfDate: '2026-07-12',
			annualInterestRateBps: 0
		});
		await createPlan(db, {
			accountId: account.id,
			categoryId: 'cat-installment-plan',
			direction: 'expense',
			cadence: 'monthly',
			amountCents: 10000,
			nextDate: '2026-07-15',
			liabilityId: liability.id
		});

		await expect(
			updateLiability(db, { id: liability.id, annualInterestRateBps: null })
		).rejects.toThrow('linked to plans require an interest rate');
		expect(
			firstValue<number>(
				sqlite,
				`SELECT annual_interest_rate_bps FROM marked_liabilities WHERE id = '${liability.id}'`
			)
		).toBe(0);
	});

	it('keeps a linked plan account and lifecycle synchronized', async () => {
		const firstAccount = await createAccount(db, { name: 'First Giro' });
		const secondAccount = await createAccount(db, { name: 'Second Giro' });
		const liability = await createLiability(db, {
			accountId: firstAccount.id,
			name: 'Vehicle loan',
			amountCents: 100000,
			asOfDate: '2026-07-12',
			annualInterestRateBps: 0
		});
		const plan = await createPlan(db, {
			accountId: firstAccount.id,
			categoryId: 'cat-installment-plan',
			label: 'Car installment',
			direction: 'expense',
			cadence: 'monthly',
			amountCents: 10000,
			nextDate: '2026-07-15',
			liabilityId: liability.id
		});

		await updateLiability(db, {
			id: liability.id,
			accountId: secondAccount.id,
			status: 'cleared'
		});
		expect(
			sqlite.exec(`SELECT account_id, status FROM plans WHERE id = '${plan.id}'`)[0]?.values
		).toEqual([[secondAccount.id, 'done']]);

		await updateLiability(db, { id: liability.id, status: 'active' });
		expect(firstValue<string>(sqlite, `SELECT status FROM plans WHERE id = '${plan.id}'`)).toBe(
			'active'
		);
	});

	it('keeps a manually cleared positive balance and done plan through reconciliation', async () => {
		const account = await createAccount(db, { name: 'Main Giro' });
		const liability = await createLiability(db, {
			accountId: account.id,
			name: 'Manual payoff',
			amountCents: 75000,
			asOfDate: '2026-07-01',
			annualInterestRateBps: 0
		});
		const plan = await createPlan(db, {
			accountId: account.id,
			categoryId: 'cat-installment-plan',
			direction: 'expense',
			cadence: 'monthly',
			amountCents: 10000,
			nextDate: '2026-07-10',
			liabilityId: liability.id
		});

		await updateLiability(db, { id: liability.id, status: 'cleared' });
		await reconcilePlans(db);

		expect(await listLiabilities(db)).toMatchObject([
			{ id: liability.id, amountCents: 75000, status: 'cleared', plan: { status: 'done' } }
		]);
		expect(firstValue<string>(sqlite, `SELECT status FROM plans WHERE id = '${plan.id}'`)).toBe(
			'done'
		);

		await updateLiability(db, { id: liability.id, status: 'active' });
		expect(await listLiabilities(db)).toMatchObject([
			{ id: liability.id, amountCents: 75000, status: 'active', plan: { status: 'active' } }
		]);
	});

	it('rejects reactivating a liability with no remaining balance', async () => {
		const account = await createAccount(db, { name: 'Main Giro' });
		const liability = await createLiability(db, {
			accountId: account.id,
			name: 'Paid loan',
			amountCents: 10000,
			asOfDate: '2026-07-01',
			annualInterestRateBps: 0
		});
		await createPlan(db, {
			accountId: account.id,
			categoryId: 'cat-installment-plan',
			counterparty: 'Loan Bank',
			direction: 'expense',
			cadence: 'monthly',
			amountCents: 10000,
			nextDate: '2026-07-10',
			liabilityId: liability.id
		});
		await db
			.prepare(
				`INSERT INTO transactions (id,account_id,category_id,dedupe_key,booking_date,amount_cents,payee,search_text)
				VALUES ('paid-loan','${account.id}','cat-installment-plan','paid-loan','2026-07-10',-10000,'Loan Bank','')`
			)
			.run();
		await reconcilePlans(db);

		await expect(updateLiability(db, { id: liability.id, status: 'active' })).rejects.toThrow(
			'no remaining balance'
		);
	});

	it('does not touch matching history or schedule for name and note changes', async () => {
		const account = await createAccount(db, { name: 'Main Giro' });
		const liability = await createLiability(db, {
			accountId: account.id,
			name: 'Original name',
			amountCents: 50000,
			asOfDate: '2026-07-01',
			annualInterestRateBps: 0
		});
		const plan = await createPlan(db, {
			accountId: account.id,
			categoryId: 'cat-installment-plan',
			counterparty: 'Loan Bank',
			direction: 'expense',
			cadence: 'monthly',
			amountCents: 10000,
			nextDate: '2026-07-10',
			liabilityId: liability.id
		});
		await db
			.prepare(
				`INSERT INTO transactions (id,account_id,category_id,dedupe_key,booking_date,amount_cents,payee,search_text)
			 VALUES ('metadata-payment','${account.id}','cat-installment-plan','metadata-payment','2026-07-10',-10000,'Loan Bank','')`
			)
			.run();
		await reconcilePlans(db);
		const before = sqlite.exec(
			`SELECT p.next_date, p.schedule_occurrence_index, COUNT(pt.transaction_id)
			 FROM plans p LEFT JOIN plan_transactions pt ON pt.plan_id=p.id WHERE p.id='${plan.id}' GROUP BY p.id`
		)[0]?.values;

		await updateLiability(db, { id: liability.id, name: 'Renamed loan', note: 'Only metadata' });

		expect(
			sqlite.exec(
				`SELECT p.next_date, p.schedule_occurrence_index, COUNT(pt.transaction_id)
			 FROM plans p LEFT JOIN plan_transactions pt ON pt.plan_id=p.id WHERE p.id='${plan.id}' GROUP BY p.id`
			)[0]?.values
		).toEqual(before);
	});

	it('recalculates interest splits only when rate or baseline values actually change', async () => {
		const account = await createAccount(db, { name: 'Main Giro' });
		const liability = await createLiability(db, {
			accountId: account.id,
			name: 'Interest loan',
			amountCents: 100000,
			asOfDate: '2026-07-01',
			annualInterestRateBps: 1200
		});
		await createPlan(db, {
			accountId: account.id,
			categoryId: 'cat-installment-plan',
			counterparty: 'Loan Bank',
			direction: 'expense',
			cadence: 'monthly',
			amountCents: 10000,
			nextDate: '2026-07-10',
			liabilityId: liability.id
		});
		await db
			.prepare(
				`INSERT INTO transactions (id,account_id,category_id,dedupe_key,booking_date,amount_cents,payee,search_text)
			 VALUES ('interest-payment','${account.id}','cat-installment-plan','interest-payment','2026-07-10',-10000,'Loan Bank','')`
			)
			.run();
		await reconcilePlans(db);
		await db
			.prepare(
				"UPDATE plan_transactions SET interest_cents=777, principal_cents=888 WHERE transaction_id='interest-payment'"
			)
			.run();

		await updateLiability(db, {
			id: liability.id,
			amountCents: 100000,
			asOfDate: '2026-07-01',
			annualInterestRateBps: 1200
		});
		expect(
			sqlite.exec(
				"SELECT interest_cents, principal_cents FROM plan_transactions WHERE transaction_id='interest-payment'"
			)[0]?.values
		).toEqual([[777, 888]]);

		await updateLiability(db, { id: liability.id, annualInterestRateBps: 2400 });
		expect(
			sqlite.exec(
				"SELECT interest_cents, principal_cents FROM plan_transactions WHERE transaction_id='interest-payment'"
			)[0]?.values
		).toEqual([[2000, 8000]]);
		expect((await listLiabilities(db))[0]?.amountCents).toBe(92000);
	});

	it('rematches eligible payments when the baseline date moves earlier or later', async () => {
		const account = await createAccount(db, { name: 'Main Giro' });
		const liability = await createLiability(db, {
			accountId: account.id,
			name: 'Moving baseline',
			amountCents: 50000,
			asOfDate: '2026-07-10',
			annualInterestRateBps: 0
		});
		const plan = await createPlan(db, {
			accountId: account.id,
			categoryId: 'cat-installment-plan',
			counterparty: 'Loan Bank',
			direction: 'expense',
			cadence: 'monthly',
			amountCents: 10000,
			nextDate: '2026-06-10',
			liabilityId: liability.id
		});
		await db
			.prepare(
				`INSERT INTO transactions (id,account_id,category_id,dedupe_key,booking_date,amount_cents,payee,search_text)
			 VALUES ('baseline-july','${account.id}','cat-installment-plan','baseline-july','2026-07-10',-10000,'Loan Bank',''),
			 ('baseline-august','${account.id}','cat-installment-plan','baseline-august','2026-08-10',-10000,'Loan Bank','')`
			)
			.run();
		await reconcilePlans(db);
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM plan_transactions')).toBe(1);

		await updateLiability(db, {
			id: liability.id,
			amountCents: 50000,
			asOfDate: '2026-06-09'
		});
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM plan_transactions')).toBe(2);
		expect((await listLiabilities(db))[0]?.amountCents).toBe(30000);

		await updateLiability(db, {
			id: liability.id,
			amountCents: 60000,
			asOfDate: '2026-08-10'
		});
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM plan_transactions')).toBe(0);
		expect((await listLiabilities(db))[0]?.amountCents).toBe(60000);
		expect(firstValue<string>(sqlite, `SELECT next_date FROM plans WHERE id='${plan.id}'`)).toBe(
			'2026-09-10'
		);
	});

	it('keeps the original monthly payment day across short months', () => {
		expect(
			projectLiability({
				amountCents: 6100,
				annualInterestRateBps: 0,
				paymentCents: 100,
				cadence: 'monthly',
				nextDate: '2026-07-30'
			}).estimatedPayoffDate
		).toBe('2031-07-30');
	});

	it('uses the plan anchor when the current installment was clamped by February', () => {
		expect(
			projectLiability({
				amountCents: 200,
				annualInterestRateBps: 0,
				paymentCents: 100,
				cadence: 'monthly',
				nextDate: '2026-02-28',
				scheduleAnchorDate: '2026-01-31',
				scheduleOccurrenceIndex: 1
			}).estimatedPayoffDate
		).toBe('2026-03-31');
	});
});
