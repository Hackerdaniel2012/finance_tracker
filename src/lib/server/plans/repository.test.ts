import { describe, expect, it } from 'vitest';
import {
	applyMigrations,
	createTestDatabase,
	createTestDbClient,
	firstValue
} from '../../../../tests/db/test-database';
import { createPlan, deletePlan, getPlan, updatePlan } from './repository';
import { calculatePrincipalPayment, reconcilePlans } from './matching';
import { rematchPlans } from './rematching';

async function setup() {
	const database = await createTestDatabase();
	await applyMigrations(database);
	const db = createTestDbClient(database);
	await db.prepare("INSERT INTO accounts (id,name) VALUES ('account','Checking')").run();
	await db
		.prepare(
			"INSERT INTO categories (id,name,type) VALUES ('expense','Expense','expense'),('income','Income','income')"
		)
		.run();
	return { db, database };
}
describe('plans repository', () => {
	it('creates once and recurring income or expense plans', async () => {
		const { db } = await setup();
		const once = await createPlan(db, {
			direction: 'expense',
			cadence: 'once',
			amountCents: 1200,
			nextDate: '2026-07-20',
			counterparty: 'Shop'
		});
		const recurring = await createPlan(db, {
			direction: 'income',
			cadence: 'monthly',
			amountCents: 250000,
			nextDate: '2026-08-01',
			endDate: '2026-12-01',
			categoryId: 'income'
		});
		expect(once.cadence).toBe('once');
		expect(recurring.direction).toBe('income');
		await expect(
			createPlan(db, {
				direction: 'expense',
				cadence: 'once',
				amountCents: 1,
				nextDate: '2026-07-01',
				endDate: '2026-08-01'
			})
		).rejects.toThrow('Once plans cannot have an end date');
	});
	it('completes a unique once match and advances a recurring match', async () => {
		const { db } = await setup();
		const once = await createPlan(db, {
			accountId: 'account',
			direction: 'expense',
			cadence: 'once',
			amountCents: 1000,
			nextDate: '2026-07-10',
			counterparty: 'Store'
		});
		const recurring = await createPlan(db, {
			accountId: 'account',
			direction: 'income',
			cadence: 'monthly',
			amountCents: 5000,
			nextDate: '2026-07-10',
			counterparty: 'Employer'
		});
		await db
			.prepare(
				"INSERT INTO transactions (id,account_id,dedupe_key,booking_date,amount_cents,payee,search_text) VALUES ('t1','account','one','2026-07-11',-1000,'Store',''),('t2','account','two','2026-07-10',5000,'Employer','')"
			)
			.run();
		await reconcilePlans(db);
		expect((await getPlan(db, once.id))?.status).toBe('done');
		expect((await getPlan(db, once.id))?.lastTransactionDate).toBe('2026-07-11');
		expect((await getPlan(db, recurring.id))?.nextDate).toBe('2026-08-10');
	});
	it('matches recurring income up to seven days early but not eight days early', async () => {
		const { db } = await setup();
		const withinWindow = await createPlan(db, {
			accountId: 'account',
			direction: 'income',
			cadence: 'monthly',
			amountCents: 250000,
			nextDate: '2026-07-31',
			counterparty: 'Early Employer'
		});
		const outsideWindow = await createPlan(db, {
			accountId: 'account',
			direction: 'income',
			cadence: 'monthly',
			amountCents: 240000,
			nextDate: '2026-07-31',
			counterparty: 'Too Early Employer'
		});
		await db
			.prepare(
				"INSERT INTO transactions (id,account_id,dedupe_key,booking_date,amount_cents,payee,search_text) VALUES ('seven-days-early','account','seven-days-early','2026-07-24',250000,'Early Employer',''),('eight-days-early','account','eight-days-early','2026-07-23',240000,'Too Early Employer','')"
			)
			.run();

		await reconcilePlans(db);

		expect((await getPlan(db, withinWindow.id))?.lastTransactionDate).toBe('2026-07-24');
		expect((await getPlan(db, withinWindow.id))?.nextDate).toBe('2026-08-31');
		expect((await getPlan(db, outsideWindow.id))?.transactionCount).toBe(0);
		expect((await getPlan(db, outsideWindow.id))?.nextDate).toBe('2026-07-31');
	});
	it('does not match an ambiguous transaction', async () => {
		const { db } = await setup();
		const first = await createPlan(db, {
			accountId: 'account',
			direction: 'expense',
			cadence: 'once',
			amountCents: 1000,
			nextDate: '2026-07-10'
		});
		const second = await createPlan(db, {
			accountId: 'account',
			direction: 'expense',
			cadence: 'once',
			amountCents: 1000,
			nextDate: '2026-07-10'
		});
		await db
			.prepare(
				"INSERT INTO transactions (id,account_id,dedupe_key,booking_date,amount_cents,search_text) VALUES ('t','account','three','2026-07-10',-1000,'')"
			)
			.run();
		await reconcilePlans(db);
		expect((await getPlan(db, first.id))?.status).toBe('active');
		expect((await getPlan(db, second.id))?.status).toBe('active');
	});

	it('recovers a confirmed recurring plan after its evidence transaction was deleted and reimported', async () => {
		const { db, database } = await setup();
		const plan = await createPlan(db, {
			accountId: 'account',
			categoryId: 'expense',
			counterparty: 'OPENAI *CHATGPT SUBSCR',
			direction: 'expense',
			cadence: 'monthly',
			amountCents: 2063,
			nextDate: '2026-08-05'
		});
		await db
			.prepare("UPDATE plans SET source='recurring_suggestion' WHERE id=?")
			.bind(plan.id)
			.run();
		await db
			.prepare(
				"INSERT INTO transactions (id,account_id,dedupe_key,booking_date,amount_cents,payee,description,search_text) VALUES ('old-evidence','account','old-evidence','2026-07-05',-2063,'OPENAI *CHATGPT SUBSCR','Old evidence','')"
			)
			.run();
		await db
			.prepare(
				"INSERT INTO plan_transactions (plan_id,transaction_id,match_kind) VALUES (?,'old-evidence','evidence')"
			)
			.bind(plan.id)
			.run();
		await db.prepare("DELETE FROM transactions WHERE id='old-evidence'").run();
		await db
			.prepare(
				"INSERT INTO transactions (id,account_id,dedupe_key,booking_date,amount_cents,payee,description,search_text) VALUES ('reimported','account','reimported','2026-07-05',-2084,'OPENAI *CHATGPT SUBSCR','OPENAI *CHATGPT SUBSCR','')"
			)
			.run();
		await db
			.prepare(
				"INSERT INTO transaction_review_flags (id,transaction_id,reason,status) VALUES ('review','reimported','unknown_category','open')"
			)
			.run();

		await reconcilePlans(db);

		const recovered = await getPlan(db, plan.id);
		expect(recovered).toMatchObject({
			nextDate: '2026-08-05',
			scheduleAnchorDate: '2026-07-05',
			scheduleOccurrenceIndex: 1,
			transactionCount: 1,
			lastTransactionDate: '2026-07-05',
			transactions: [
				{
					transactionId: 'reimported',
					bookingDate: '2026-07-05',
					amountCents: -2084,
					categoryName: 'Expense',
					matchKind: 'automatic',
					scheduledDate: '2026-07-05'
				}
			]
		});
		expect(
			database.exec(
				"SELECT category_id, classification_status FROM transactions WHERE id='reimported'"
			)[0]?.values
		).toEqual([['expense', 'auto']]);
		expect(
			database.exec(
				"SELECT reason, status, resolved_at IS NOT NULL FROM transaction_review_flags WHERE transaction_id='reimported'"
			)[0]?.values
		).toEqual([['unknown_category', 'resolved', 1]]);
	});

	it('preserves non-category review flags when assigning plan categories', async () => {
		const { db, database } = await setup();
		await createPlan(db, {
			accountId: 'account',
			categoryId: 'expense',
			counterparty: 'Manual Review Merchant',
			direction: 'expense',
			cadence: 'once',
			amountCents: 1200,
			nextDate: '2026-07-10'
		});
		await createPlan(db, {
			accountId: 'account',
			categoryId: 'expense',
			counterparty: 'Parse Warning Merchant',
			direction: 'expense',
			cadence: 'once',
			amountCents: 1300,
			nextDate: '2026-07-10'
		});
		await db
			.prepare(
				`INSERT INTO transactions (
					id, account_id, dedupe_key, booking_date, amount_cents, payee, search_text
				) VALUES
					('manual-review', 'account', 'manual-review', '2026-07-10', -1200, 'Manual Review Merchant', ''),
					('parse-warning', 'account', 'parse-warning', '2026-07-10', -1300, 'Parse Warning Merchant', '')`
			)
			.run();
		await db
			.prepare(
				`INSERT INTO transaction_review_flags (id, transaction_id, reason, status) VALUES
					('manual-flag', 'manual-review', 'manual_review', 'open'),
					('parse-flag', 'parse-warning', 'parse_warning', 'open')`
			)
			.run();

		await reconcilePlans(db);

		expect(
			database.exec(
				'SELECT reason, status, resolved_at FROM transaction_review_flags ORDER BY reason'
			)[0]?.values
		).toEqual([
			['manual_review', 'open', null],
			['parse_warning', 'open', null]
		]);
		expect(
			database.exec(
				"SELECT COUNT(*) FROM transactions WHERE category_id='expense' AND classification_status='auto'"
			)[0]?.values
		).toEqual([[2]]);
	});

	it('keeps the original month-end anchor when recovering an earlier occurrence', async () => {
		const { db } = await setup();
		const plan = await createPlan(db, {
			accountId: 'account',
			counterparty: 'Month End Employer',
			direction: 'income',
			cadence: 'monthly',
			amountCents: 500000,
			nextDate: '2026-01-31'
		});
		await db
			.prepare(
				`UPDATE plans
				SET source = 'recurring_suggestion', next_date = '2026-02-28',
					schedule_anchor_date = '2026-01-31', schedule_occurrence_index = 1
				WHERE id = ?`
			)
			.bind(plan.id)
			.run();
		await db
			.prepare(
				`INSERT INTO transactions (
					id, account_id, dedupe_key, booking_date, amount_cents, payee, search_text
				) VALUES ('january-pay', 'account', 'january-pay', '2026-01-31', 500000,
					'Month End Employer', '')`
			)
			.run();

		await reconcilePlans(db);
		expect(await getPlan(db, plan.id)).toMatchObject({
			scheduleAnchorDate: '2026-01-31',
			scheduleOccurrenceIndex: 1,
			nextDate: '2026-02-28',
			transactionCount: 1
		});

		await db
			.prepare(
				`INSERT INTO transactions (
					id, account_id, dedupe_key, booking_date, amount_cents, payee, search_text
				) VALUES ('february-pay', 'account', 'february-pay', '2026-02-28', 500000,
					'Month End Employer', '')`
			)
			.run();
		await reconcilePlans(db);
		expect(await getPlan(db, plan.id)).toMatchObject({
			scheduleAnchorDate: '2026-01-31',
			scheduleOccurrenceIndex: 2,
			nextDate: '2026-03-31',
			transactionCount: 2
		});
	});

	it('keeps amount tolerance exclusive to confirmed recurring suggestions', async () => {
		const { db } = await setup();
		const plan = await createPlan(db, {
			accountId: 'account',
			counterparty: 'Variable service',
			direction: 'expense',
			cadence: 'monthly',
			amountCents: 2000,
			nextDate: '2026-07-05'
		});
		await db
			.prepare(
				"INSERT INTO transactions (id,account_id,dedupe_key,booking_date,amount_cents,payee,search_text) VALUES ('manual-drift','account','manual-drift','2026-07-05',-2021,'Variable service','')"
			)
			.run();

		await reconcilePlans(db);

		expect((await getPlan(db, plan.id))?.transactionCount).toBe(0);
	});
	it('reduces a linked liability by principal while retaining the interest portion', async () => {
		const { db, database } = await setup();
		await db
			.prepare(
				"INSERT INTO marked_liabilities (id,account_id,name,amount_cents,as_of_date,annual_interest_rate_bps) VALUES ('loan','account','Car loan',1000000,'2026-07-01',600)"
			)
			.run();
		const plan = await createPlan(db, {
			accountId: 'account',
			direction: 'expense',
			cadence: 'monthly',
			amountCents: 10000,
			nextDate: '2026-07-10',
			counterparty: 'Auto Bank',
			categoryId: 'cat-installment-plan',
			liabilityId: 'loan'
		});
		await db
			.prepare(
				"INSERT INTO transactions (id,account_id,category_id,dedupe_key,booking_date,amount_cents,payee,search_text) VALUES ('loan-payment','account','cat-installment-plan','loan-payment','2026-07-10',-10000,'Auto Bank','')"
			)
			.run();
		await reconcilePlans(db);
		expect((await getPlan(db, plan.id))?.nextDate).toBe('2026-08-10');
		expect(
			database.exec(
				"SELECT amount_cents, as_of_date, status FROM marked_liabilities WHERE id = 'loan'"
			)[0]?.values
		).toEqual([[995000, '2026-07-10', 'active']]);
	});
	it('treats the full payment as principal for a zero-interest liability', () => {
		expect(calculatePrincipalPayment(100000, 10000, 0, 'monthly')).toBe(10000);
	});
	it('defensively treats a missing linked interest rate as zero for future matches', async () => {
		const { db, database } = await setup();
		await db
			.prepare(
				"INSERT INTO marked_liabilities (id,account_id,name,amount_cents,as_of_date,annual_interest_rate_bps) VALUES ('legacy-loan','account','Legacy loan',50000,'2026-07-01',NULL)"
			)
			.run();
		const plan = await createPlan(db, {
			accountId: 'account',
			categoryId: 'cat-installment-plan',
			counterparty: 'Loan Bank',
			direction: 'expense',
			cadence: 'monthly',
			amountCents: 10000,
			nextDate: '2026-07-10',
			liabilityId: 'legacy-loan'
		});
		await db
			.prepare(
				"INSERT INTO transactions (id,account_id,category_id,dedupe_key,booking_date,amount_cents,payee,search_text) VALUES ('legacy-payment','account','cat-installment-plan','legacy-payment','2026-07-10',-10000,'Loan Bank','')"
			)
			.run();

		await reconcilePlans(db);

		expect((await getPlan(db, plan.id))?.nextDate).toBe('2026-08-10');
		expect(
			database.exec(
				"SELECT amount_cents, as_of_date FROM marked_liabilities WHERE id = 'legacy-loan'"
			)[0]?.values
		).toEqual([[40000, '2026-07-10']]);
	});
	it('clears both the liability and its plan after the final zero-interest payment', async () => {
		const { db, database } = await setup();
		await db
			.prepare(
				"INSERT INTO marked_liabilities (id,account_id,name,amount_cents,as_of_date,annual_interest_rate_bps) VALUES ('small-loan','account','Small loan',10000,'2026-07-01',0)"
			)
			.run();
		const plan = await createPlan(db, {
			accountId: 'account',
			direction: 'expense',
			cadence: 'monthly',
			amountCents: 10000,
			nextDate: '2026-07-10',
			counterparty: 'Loan Bank',
			categoryId: 'cat-installment-plan',
			liabilityId: 'small-loan'
		});
		await db
			.prepare(
				"INSERT INTO transactions (id,account_id,category_id,dedupe_key,booking_date,amount_cents,payee,search_text) VALUES ('final-payment','account','cat-installment-plan','final-payment','2026-07-10',-10000,'Loan Bank','')"
			)
			.run();

		await reconcilePlans(db);

		expect((await getPlan(db, plan.id))?.status).toBe('done');
		expect(
			database.exec(
				"SELECT amount_cents, status FROM marked_liabilities WHERE id = 'small-loan'"
			)[0]?.values
		).toEqual([[0, 'cleared']]);
	});
	it('keeps plan dates valid when updating', async () => {
		const { db } = await setup();
		const plan = await createPlan(db, {
			direction: 'income',
			cadence: 'monthly',
			amountCents: 1,
			nextDate: '2026-08-01'
		});
		const updated = await updatePlan(db, { id: plan.id, status: 'paused' });
		expect(updated.status).toBe('paused');
	});
	it('matches a sequence of daily occurrences and remains idempotent', async () => {
		const { db } = await setup();
		const plan = await createPlan(db, {
			accountId: 'account',
			direction: 'expense',
			cadence: 'daily',
			amountCents: 500,
			nextDate: '2026-07-01',
			counterparty: 'Daily service'
		});
		for (let day = 1; day <= 7; day += 1) {
			await db
				.prepare(
					'INSERT INTO transactions (id,account_id,dedupe_key,booking_date,amount_cents,payee,search_text) VALUES (?,?,?,?,?,?,?)'
				)
				.bind(
					`daily-${day}`,
					'account',
					`daily-${day}`,
					`2026-07-${String(day).padStart(2, '0')}`,
					-500,
					'Daily service',
					''
				)
				.run();
		}

		await reconcilePlans(db);
		expect((await getPlan(db, plan.id))?.nextDate).toBe('2026-07-08');
		expect((await getPlan(db, plan.id))?.transactionCount).toBe(7);
		await reconcilePlans(db);
		expect((await getPlan(db, plan.id))?.nextDate).toBe('2026-07-08');
		expect((await getPlan(db, plan.id))?.transactionCount).toBe(7);
	});
	it('keeps a month-end anchor and completes at the end date', async () => {
		const { db } = await setup();
		const monthEnd = await createPlan(db, {
			accountId: 'account',
			direction: 'expense',
			cadence: 'monthly',
			amountCents: 1000,
			nextDate: '2026-01-31',
			counterparty: 'Month end'
		});
		const ending = await createPlan(db, {
			accountId: 'account',
			direction: 'expense',
			cadence: 'monthly',
			amountCents: 2000,
			nextDate: '2026-07-10',
			endDate: '2026-07-10',
			counterparty: 'Ending service'
		});
		await db
			.prepare(
				"INSERT INTO transactions (id,account_id,dedupe_key,booking_date,amount_cents,payee,search_text) VALUES ('jan','account','jan','2026-01-31',-1000,'Month end',''),('feb','account','feb','2026-02-28',-1000,'Month end',''),('ending','account','ending','2026-07-10',-2000,'Ending service','')"
			)
			.run();

		await reconcilePlans(db);
		expect((await getPlan(db, monthEnd.id))?.nextDate).toBe('2026-03-31');
		expect((await getPlan(db, ending.id))?.status).toBe('done');
	});
	it('does not reset automatic schedule history for a label-only edit', async () => {
		const { db } = await setup();
		const plan = await createPlan(db, {
			accountId: 'account',
			direction: 'expense',
			cadence: 'monthly',
			amountCents: 1000,
			nextDate: '2026-01-31',
			counterparty: 'Month end'
		});
		await db
			.prepare(
				"INSERT INTO transactions (id,account_id,dedupe_key,booking_date,amount_cents,payee,search_text) VALUES ('anchor-jan','account','anchor-jan','2026-01-31',-1000,'Month end',''),('anchor-feb','account','anchor-feb','2026-02-28',-1000,'Month end','')"
			)
			.run();
		await reconcilePlans(db);
		await updatePlan(db, { id: plan.id, label: 'Renamed contract' });
		const updated = await getPlan(db, plan.id);
		expect(updated?.nextDate).toBe('2026-03-31');
		expect(updated?.transactionCount).toBe(2);
	});
	it('preserves the original anchor when a full patch repeats the current next date', async () => {
		const { db } = await setup();
		const plan = await createPlan(db, {
			accountId: 'account',
			direction: 'expense',
			cadence: 'monthly',
			amountCents: 1000,
			nextDate: '2026-01-31',
			counterparty: 'Month end'
		});
		await db
			.prepare(
				"INSERT INTO transactions (id,account_id,dedupe_key,booking_date,amount_cents,payee,search_text) VALUES ('full-patch-jan','account','full-patch-jan','2026-01-31',-1000,'Month end','')"
			)
			.run();
		await reconcilePlans(db);
		expect((await getPlan(db, plan.id))?.nextDate).toBe('2026-02-28');

		const updated = await updatePlan(db, {
			id: plan.id,
			accountId: 'account',
			categoryId: null,
			label: null,
			counterparty: 'Month end',
			direction: 'expense',
			cadence: 'monthly',
			amountCents: 1000,
			nextDate: '2026-02-28',
			endDate: '2026-12-31',
			status: 'active',
			liabilityId: null,
			note: null
		});

		expect(updated.scheduleAnchorDate).toBe('2026-01-31');
		expect(updated.nextDate).toBe('2026-02-28');
		expect(updated.scheduleOccurrenceIndex).toBe(1);
		expect(updated.transactionCount).toBe(1);
	});
	it('uses a genuinely changed next date as the new anchor', async () => {
		const { db } = await setup();
		const plan = await createPlan(db, {
			direction: 'expense',
			cadence: 'monthly',
			amountCents: 1000,
			nextDate: '2026-01-31'
		});

		const updated = await updatePlan(db, { id: plan.id, nextDate: '2026-04-30' });

		expect(updated.scheduleAnchorDate).toBe('2026-04-30');
		expect(updated.nextDate).toBe('2026-04-30');
		expect(updated.scheduleOccurrenceIndex).toBe(0);
	});
	it('excludes payments on or before a liability baseline and applies later payments once', async () => {
		const { db, database } = await setup();
		const plan = await createPlan(db, {
			accountId: 'account',
			direction: 'expense',
			cadence: 'monthly',
			amountCents: 10000,
			nextDate: '2026-07-10',
			counterparty: 'Loan Bank',
			liability: {
				name: 'Baseline loan',
				amountCents: 50000,
				asOfDate: '2026-07-10',
				annualInterestRateBps: 0
			}
		});
		await db
			.prepare(
				`INSERT INTO transactions (id,account_id,category_id,dedupe_key,booking_date,amount_cents,payee,search_text)
				VALUES ('baseline-day','account','cat-installment-plan','baseline-day','2026-07-10',-10000,'Loan Bank',''),
				('after-baseline','account','cat-installment-plan','after-baseline','2026-08-10',-10000,'Loan Bank','')`
			)
			.run();

		await rematchPlans(db, [plan.id]);

		expect((await getPlan(db, plan.id))?.nextDate).toBe('2026-09-10');
		expect((await getPlan(db, plan.id))?.transactionCount).toBe(1);
		expect(
			database.exec(
				"SELECT transaction_id FROM plan_transactions WHERE match_kind = 'automatic'"
			)[0]?.values
		).toEqual([['after-baseline']]);
		expect(firstValue<number>(database, 'SELECT amount_cents FROM marked_liabilities')).toBe(40000);
	});
	it('keeps the first scheduled liability occurrence strictly after a baseline without matches', async () => {
		const { db } = await setup();
		const plan = await createPlan(db, {
			accountId: 'account',
			direction: 'expense',
			cadence: 'monthly',
			amountCents: 1000,
			nextDate: '2026-06-10',
			liability: {
				name: 'Future loan',
				amountCents: 10000,
				asOfDate: '2026-07-10',
				annualInterestRateBps: 0
			}
		});

		await rematchPlans(db, [plan.id]);

		expect((await getPlan(db, plan.id))?.nextDate).toBe('2026-08-10');
		expect((await getPlan(db, plan.id))?.scheduleOccurrenceIndex).toBe(2);
	});
	it('rejects deleting a plan that is linked to a liability', async () => {
		const { db } = await setup();
		await db
			.prepare(
				"INSERT INTO marked_liabilities (id,name,amount_cents,as_of_date) VALUES ('delete-loan','Loan',10000,'2026-07-01')"
			)
			.run();
		const plan = await createPlan(db, {
			direction: 'expense',
			cadence: 'monthly',
			amountCents: 1000,
			nextDate: '2026-07-10',
			categoryId: 'cat-installment-plan',
			liabilityId: 'delete-loan'
		});
		await expect(deletePlan(db, plan.id)).rejects.toThrow('must be deleted through the liability');
	});
	it('rejects invalid updates to a liability-linked plan and synchronizes its account', async () => {
		const { db, database } = await setup();
		await db.prepare("INSERT INTO accounts (id,name) VALUES ('other','Other')").run();
		await db
			.prepare(
				"INSERT INTO marked_liabilities (id,account_id,name,amount_cents,as_of_date,annual_interest_rate_bps) VALUES ('invariant-loan','account','Loan',100000,'2026-07-01',0)"
			)
			.run();
		const plan = await createPlan(db, {
			accountId: 'account',
			categoryId: 'cat-installment-plan',
			direction: 'expense',
			cadence: 'monthly',
			amountCents: 10000,
			nextDate: '2026-07-10',
			liabilityId: 'invariant-loan'
		});

		await expect(updatePlan(db, { id: plan.id, direction: 'income' })).rejects.toThrow(
			'Liability plans must be expenses'
		);
		await expect(updatePlan(db, { id: plan.id, cadence: 'once' })).rejects.toThrow(
			'Liability plans must be recurring'
		);
		await updatePlan(db, { id: plan.id, accountId: 'other' });
		expect(
			database.exec("SELECT account_id FROM marked_liabilities WHERE id = 'invariant-loan'")[0]
				?.values
		).toEqual([['other']]);
		await db
			.prepare("UPDATE marked_liabilities SET status = 'cleared' WHERE id = 'invariant-loan'")
			.run();
		await expect(updatePlan(db, { id: plan.id, status: 'active' })).rejects.toThrow(
			'Cleared liabilities require a done plan'
		);
	});
});
