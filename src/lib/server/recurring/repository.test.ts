import { beforeEach, describe, expect, it } from 'vitest';
import {
	applyMigrations,
	createTestDatabase,
	createTestDbClient
} from '../../../../tests/db/test-database';
import { createAccount } from '../accounts/repository';
import type { DbClient } from '../db-client';
import {
	confirmRecurringSuggestion,
	generateRecurringSuggestions,
	listRecurringGroups,
	updateRecurringGroup
} from './repository';

let db: DbClient;
let sqlite: Awaited<ReturnType<typeof createTestDatabase>>;

beforeEach(async () => {
	sqlite = await createTestDatabase();
	await applyMigrations(sqlite);
	db = createTestDbClient(sqlite);
});

describe('recurring repository', () => {
	it('creates a plan and liability atomically from a recurring suggestion', async () => {
		const account = await createAccount(db, { name: 'Main Giro' });
		const id = await insertRecurringGroup({
			accountId: account.id,
			payee: 'Auto Bank Loan',
			expectedAmountCents: 25000,
			nextDate: '2026-08-01'
		});

		const plan = await confirmRecurringSuggestion(db, {
			id,
			direction: 'outgoing',
			categoryId: 'cat-utilities',
			cadence: 'monthly',
			expectedAmountCents: 25000,
			nextDate: '2026-08-01',
			liability: {
				name: 'Car loan',
				amountCents: 800000,
				asOfDate: '2026-07-12',
				annualInterestRateBps: 599
			}
		});

		expect(plan).toMatchObject({
			categoryId: 'cat-installment-plan',
			direction: 'expense',
			cadence: 'monthly',
			amountCents: 25000
		});
		expect(
			sqlite.exec(
				"SELECT name, amount_cents, as_of_date, annual_interest_rate_bps, status FROM marked_liabilities WHERE name = 'Car loan'"
			)[0]?.values
		).toEqual([['Car loan', 800000, '2026-07-12', 599, 'active']]);
		expect(
			sqlite.exec(`SELECT status, plan_id FROM recurring_groups WHERE id = '${id}'`)[0]?.values[0]
		).toEqual(['confirmed', plan.id]);
	});

	it('lists and updates recurring groups', async () => {
		const account = await createAccount(db, { name: 'Main Giro' });
		const importAccount = { ...account, accountId: account.id, bankId: 'n26' as const };
		const id = await insertRecurringGroup({
			accountId: account.id,
			payee: 'Rent',
			cadence: 'monthly',
			expectedAmountCents: 90000,
			nextDate: '2026-07-31',
			confidence: 88
		});

		await expect(listRecurringGroups(db)).resolves.toMatchObject([
			{
				id,
				accountName: 'Main Giro',
				payee: 'Rent',
				cadence: 'monthly',
				expectedAmountCents: 90000,
				nextDate: '2026-07-31',
				status: 'suggested',
				confidence: 88,
				source: 'imported',
				transactionCount: 0
			}
		]);

		const updated = await updateRecurringGroup(db, {
			id,
			accountId: null,
			label: 'Home rent',
			payee: 'Warm Rent',
			status: 'ignored',
			confidence: 100,
			source: 'imported',
			nextDate: '2026-07-31',
			endDate: '2026-12-31'
		});

		expect(updated).toMatchObject({
			id,
			accountId: null,
			payee: 'Warm Rent',
			label: 'Home rent',
			status: 'ignored',
			confidence: 100,
			source: 'imported',
			nextDate: '2026-07-31',
			endDate: '2026-12-31'
		});
	});

	it('validates the merged next and end dates for partial updates', async () => {
		const laterNextDate = await insertRecurringGroup({
			payee: 'Bounded plan',
			nextDate: '2026-07-31',
			endDate: '2026-08-31'
		});
		await expect(
			updateRecurringGroup(db, { id: laterNextDate, nextDate: '2026-09-01' })
		).rejects.toThrow('endDate must be on or after nextDate');

		const earlierEndDate = await insertRecurringGroup({
			payee: 'Second bounded plan',
			nextDate: '2026-09-01',
			endDate: '2026-12-31'
		});
		await expect(
			updateRecurringGroup(db, { id: earlierEndDate, endDate: '2026-08-31' })
		).rejects.toThrow('endDate must be on or after nextDate');
	});

	it('returns not found errors for missing links and groups', async () => {
		const id = await insertRecurringGroup({ payee: 'Power Co' });

		await expect(updateRecurringGroup(db, { id, accountId: 'missing' })).rejects.toThrow(
			'Account not found'
		);
		await expect(updateRecurringGroup(db, { id: 'missing', status: 'ignored' })).rejects.toThrow(
			'Recurring group not found'
		);
	});

	it('suggests monthly recurring groups after three stable similar transactions', async () => {
		const account = await createAccount(db, { name: 'Main Giro' });
		const importAccount = { ...account, accountId: account.id, bankId: 'n26' as const };
		await insertTransaction({
			accountId: account.id,
			categoryId: 'cat-utilities',
			payee: 'Power Co',
			bookingDate: '2026-04-15',
			amountCents: -4600,
			description: 'April invoice'
		});
		await insertTransaction({
			accountId: account.id,
			categoryId: 'cat-utilities',
			payee: 'Power Co',
			bookingDate: '2026-05-15',
			amountCents: -4600,
			description: 'May invoice'
		});
		await insertTransaction({
			accountId: account.id,
			categoryId: 'cat-utilities',
			payee: 'Power Co',
			bookingDate: '2026-06-14',
			amountCents: -4600,
			description: 'June invoice'
		});

		const suggestions = await generateRecurringSuggestions(db, '2026-07-12');
		expect(suggestions).toEqual([
			expect.objectContaining({
				accountId: account.id,
				categoryId: 'cat-utilities',
				payee: 'Power Co',
				cadence: 'monthly',
				expectedAmountCents: 4600,
				nextDate: '2026-07-14',
				status: 'suggested',
				source: 'imported',
				transactionCount: 3
			})
		]);
		expect(suggestions[0].evidence.map((item) => item.description)).toEqual([
			'June invoice',
			'May invoice',
			'April invoice'
		]);
		await expect(generateRecurringSuggestions(db, '2026-07-12')).resolves.toEqual([]);
	});

	it('suggests weekly, biweekly, quarterly, and yearly recurring groups', async () => {
		const account = await createAccount(db, { name: 'Main Giro' });
		const importAccount = { ...account, accountId: account.id, bankId: 'n26' as const };
		await insertStableSeries(account.id, 'Weekly News', ['2026-06-01', '2026-06-08', '2026-06-15']);
		await insertStableSeries(account.id, 'Biweekly Cleaning', [
			'2026-06-02',
			'2026-06-16',
			'2026-06-30'
		]);
		await insertStableSeries(account.id, 'Quarterly Tax', [
			'2025-12-31',
			'2026-03-31',
			'2026-06-30'
		]);
		await insertStableSeries(account.id, 'Yearly Domain', [
			'2024-07-01',
			'2025-07-01',
			'2026-07-01'
		]);

		const suggestions = await generateRecurringSuggestions(db, '2026-07-12');

		expect(suggestions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					payee: 'Weekly News',
					cadence: 'weekly',
					nextDate: '2026-07-13'
				}),
				expect.objectContaining({
					payee: 'Biweekly Cleaning',
					cadence: 'biweekly',
					nextDate: '2026-07-14'
				}),
				expect.objectContaining({
					payee: 'Quarterly Tax',
					cadence: 'quarterly',
					nextDate: '2026-09-30'
				}),
				expect.objectContaining({
					payee: 'Yearly Domain',
					cadence: 'yearly',
					nextDate: '2027-07-01'
				})
			])
		);
		expect(suggestions).toHaveLength(4);
	});

	it('does not suggest recurring groups for fewer than three or unstable transactions', async () => {
		const account = await createAccount(db, { name: 'Main Giro' });
		const importAccount = { ...account, accountId: account.id, bankId: 'n26' as const };
		await insertTransaction({
			accountId: account.id,
			categoryId: 'cat-utilities',
			payee: 'Two Count',
			bookingDate: '2026-05-01',
			amountCents: -2000
		});
		await insertTransaction({
			accountId: account.id,
			categoryId: 'cat-utilities',
			payee: 'Two Count',
			bookingDate: '2026-06-01',
			amountCents: -2000
		});
		await insertTransaction({
			accountId: account.id,
			categoryId: 'cat-utilities',
			payee: 'Irregular Co',
			bookingDate: '2026-04-01',
			amountCents: -3000
		});
		await insertTransaction({
			accountId: account.id,
			categoryId: 'cat-utilities',
			payee: 'Irregular Co',
			bookingDate: '2026-05-01',
			amountCents: -3000
		});
		await insertTransaction({
			accountId: account.id,
			categoryId: 'cat-utilities',
			payee: 'Irregular Co',
			bookingDate: '2026-05-12',
			amountCents: -3000
		});

		await expect(generateRecurringSuggestions(db, '2026-07-15')).resolves.toEqual([]);
	});

	it('does not treat similarly priced irregular fuel purchases as a contract', async () => {
		const account = await createAccount(db, { name: 'Main Giro' });
		for (const [date, amount] of [
			['2026-01-06', -6016],
			['2026-03-30', -6159],
			['2026-07-02', -6208]
		] as const) {
			await insertTransaction({
				accountId: account.id,
				categoryId: 'cat-transport',
				payee: 'JET.Tankstelle/Maisach',
				bookingDate: date,
				amountCents: amount
			});
		}

		await expect(generateRecurringSuggestions(db, '2026-07-12')).resolves.toEqual([]);
	});

	it('detects stable real-world series with posting drift, FX variance, and one missed interval', async () => {
		const account = await createAccount(db, { name: 'Main Giro' });
		const series: Array<[string, string, number]> = [
			['Amazon Prime', '2026-02-13', -899],
			['Amazon Prime', '2026-03-13', -899],
			['Amazon Prime', '2026-04-14', -899],
			['Amazon Prime', '2026-05-13', -899],
			['Amazon Prime', '2026-06-15', -899],
			['Melanie Jäger', '2026-03-02', -6400],
			['Melanie Jäger', '2026-04-01', -6400],
			['Melanie Jäger', '2026-05-04', -6400],
			['Melanie Jäger', '2026-06-01', -6400],
			['Melanie Jäger', '2026-07-01', -6400],
			['OPENAI *CHATGPT SUBSCR', '2026-03-05', -2059],
			['OPENAI *CHATGPT SUBSCR', '2026-04-05', -2067],
			['OPENAI *CHATGPT SUBSCR', '2026-05-06', -2039],
			['OPENAI *CHATGPT SUBSCR', '2026-06-05', -2067],
			['OPENAI *CHATGPT SUBSCR', '2026-07-05', -2084],
			['PayPal Contract', '2026-03-03', -8883],
			['PayPal Contract', '2026-03-31', -8883],
			['PayPal Contract', '2026-04-30', -8883],
			['PayPal Contract', '2026-06-01', -8883],
			['PayPal Contract', '2026-06-30', -8883]
		];
		for (const [payee, bookingDate, amountCents] of series) {
			await insertTransaction({
				accountId: account.id,
				categoryId: 'cat-utilities',
				payee,
				bookingDate,
				amountCents
			});
		}

		const suggestions = await generateRecurringSuggestions(db, '2026-07-12');

		expect(suggestions.map((item) => item.payee)).toEqual(
			expect.arrayContaining([
				'Amazon Prime',
				'Melanie Jäger',
				'OPENAI *CHATGPT SUBSCR',
				'PayPal Contract'
			])
		);
		expect(suggestions.every((item) => item.cadence === 'monthly')).toBe(true);
	});

	it('separates parallel amount series and keeps only the contract-timed series', async () => {
		const account = await createAccount(db, { name: 'Main Giro' });
		for (const [date, amount] of [
			['2026-04-17', -4350],
			['2026-04-27', -4245],
			['2026-05-18', -4350],
			['2026-05-26', -4245],
			['2026-06-17', -4350],
			['2026-06-23', -4245]
		] as const) {
			await insertTransaction({
				accountId: account.id,
				categoryId: 'cat-utilities',
				payee: 'Telekom Deutschland GmbH',
				bookingDate: date,
				amountCents: amount
			});
		}

		const suggestions = await generateRecurringSuggestions(db, '2026-07-12');

		expect(suggestions).toHaveLength(2);
		expect(suggestions.map((item) => item.expectedAmountCents).sort()).toEqual([4245, 4350]);
		expect(suggestions.every((item) => item.cadence === 'monthly')).toBe(true);
	});

	it('detects recurring income despite a one-off amount outlier', async () => {
		const account = await createAccount(db, { name: 'Main Giro' });
		for (const [date, amount] of [
			['2026-01-29', 262293],
			['2026-02-26', 262293],
			['2026-03-30', 262293],
			['2026-04-29', 367351],
			['2026-05-28', 262293],
			['2026-06-26', 262293]
		] as const) {
			await insertTransaction({
				accountId: account.id,
				categoryId: 'cat-salary',
				payee: 'Auktion + Markt AG',
				bookingDate: date,
				amountCents: amount
			});
		}

		await expect(generateRecurringSuggestions(db, '2026-07-12')).resolves.toEqual([
			expect.objectContaining({
				payee: 'Auktion + Markt AG',
				direction: 'incoming',
				cadence: 'monthly',
				expectedAmountCents: 262293
			})
		]);
	});

	it('does not suggest monthly subscriptions whose last payment is older than 31 days', async () => {
		const account = await createAccount(db, { name: 'Credit Card' });
		await insertStableSeries(account.id, 'CLAUDE.AI SUBSCRIPTION', [
			'2026-02-08',
			'2026-03-08',
			'2026-04-08'
		]);

		await expect(generateRecurringSuggestions(db, '2026-07-12')).resolves.toEqual([]);
	});

	it('keeps a monthly subscription eligible exactly 31 days after its last payment', async () => {
		const account = await createAccount(db, { name: 'Main Giro' });
		await insertStableSeries(account.id, 'Recent Subscription', [
			'2026-04-11',
			'2026-05-11',
			'2026-06-11'
		]);

		await expect(generateRecurringSuggestions(db, '2026-07-12')).resolves.toEqual([
			expect.objectContaining({ payee: 'Recent Subscription', cadence: 'monthly' })
		]);
	});

	it('requires seven consecutive days and rewards longer daily histories', async () => {
		const account = await createAccount(db, { name: 'Main Giro' });
		await insertStableSeries(account.id, 'Too Short Daily', dailyDates('2026-07-01', 6));
		await insertStableSeries(account.id, 'One Week Daily', dailyDates('2026-07-01', 7));
		await insertStableSeries(account.id, 'Three Weeks Daily', dailyDates('2026-06-20', 21));

		const suggestions = await generateRecurringSuggestions(db, '2026-07-12');
		const oneWeek = suggestions.find((item) => item.payee === 'One Week Daily');
		const threeWeeks = suggestions.find((item) => item.payee === 'Three Weeks Daily');

		expect(suggestions.some((item) => item.payee === 'Too Short Daily')).toBe(false);
		expect(oneWeek).toMatchObject({ cadence: 'daily', confidence: 80 });
		expect(threeWeeks).toMatchObject({ cadence: 'daily', confidence: 100 });
	});

	it('excludes paired internal transfers from recurring suggestions', async () => {
		const account = await createAccount(db, { name: 'Main Giro' });
		const savings = await createAccount(db, { name: 'Savings' });
		for (const bookingDate of ['2026-04-01', '2026-05-01', '2026-06-01']) {
			await insertTransaction({
				accountId: savings.id,
				categoryId: 'cat-unknown',
				payee: 'Savings',
				bookingDate,
				amountCents: -10000
			});
			await insertTransaction({
				accountId: account.id,
				categoryId: 'cat-unknown',
				payee: 'Main',
				bookingDate,
				amountCents: 10000
			});
		}
		await expect(generateRecurringSuggestions(db, '2026-07-15')).resolves.toEqual([]);
	});
});

async function insertRecurringGroup(input: {
	accountId?: string | null;
	payee: string;
	cadence?: string;
	expectedAmountCents?: number;
	nextDate?: string | null;
	endDate?: string | null;
	confidence?: number;
	categoryId?: string | null;
	direction?: 'incoming' | 'outgoing' | null;
}): Promise<string> {
	const id = crypto.randomUUID();
	await db
		.prepare(
			`INSERT INTO recurring_groups (
				id, account_id, category_id, payee, direction, cadence,
				expected_amount_cents, next_date, end_date, confidence
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			id,
			input.accountId ?? null,
			input.categoryId === undefined ? 'cat-utilities' : input.categoryId,
			input.payee,
			input.direction === undefined ? 'outgoing' : input.direction,
			input.cadence ?? 'monthly',
			input.expectedAmountCents ?? 1000,
			input.nextDate ?? '2026-07-31',
			input.endDate ?? null,
			input.confidence ?? 50
		)
		.run();

	return id;
}

async function insertStableSeries(accountId: string, payee: string, bookingDates: string[]) {
	for (const bookingDate of bookingDates) {
		await insertTransaction({
			accountId,
			categoryId: 'cat-utilities',
			payee,
			bookingDate,
			amountCents: -2500
		});
	}
}

function dailyDates(start: string, count: number): string[] {
	const dates: string[] = [];
	const date = new Date(`${start}T00:00:00.000Z`);
	for (let index = 0; index < count; index += 1) {
		dates.push(date.toISOString().slice(0, 10));
		date.setUTCDate(date.getUTCDate() + 1);
	}
	return dates;
}

async function insertTransaction(input: {
	accountId: string;
	categoryId: string;
	payee: string;
	bookingDate: string;
	amountCents: number;
	description?: string;
}) {
	await db
		.prepare(
			`INSERT INTO transactions (
				id, account_id, category_id, dedupe_key, booking_date,
				amount_cents, payee, description, search_text
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			crypto.randomUUID(),
			input.accountId,
			input.categoryId,
			`${input.payee}-${input.bookingDate}`,
			input.bookingDate,
			input.amountCents,
			input.payee,
			input.description ?? null,
			input.payee
		)
		.run();
}
