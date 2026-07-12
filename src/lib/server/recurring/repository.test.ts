import { beforeEach, describe, expect, it } from 'vitest';
import {
	applyMigrations,
	createTestDatabase,
	createTestDbClient
} from '../../../../tests/db/test-database';
import { createAccount } from '../accounts/repository';
import type { DbClient } from '../db-client';
import {
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
			status: 'confirmed',
			confidence: 100,
			source: 'confirmed_suggestion',
			nextDate: '2026-07-31'
		});

		expect(updated).toMatchObject({
			id,
			accountId: null,
			payee: 'Warm Rent',
			label: 'Home rent',
			status: 'confirmed',
			confidence: 100,
			source: 'confirmed_suggestion',
			nextDate: '2026-07-31'
		});
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
			amountCents: -4599
		});
		await insertTransaction({
			accountId: account.id,
			categoryId: 'cat-utilities',
			payee: 'Power Co',
			bookingDate: '2026-05-15',
			amountCents: -4600
		});
		await insertTransaction({
			accountId: account.id,
			categoryId: 'cat-utilities',
			payee: 'Power Co',
			bookingDate: '2026-06-14',
			amountCents: -4625
		});

		await expect(generateRecurringSuggestions(db)).resolves.toEqual([
			expect.objectContaining({
				accountId: account.id,
				categoryId: 'cat-utilities',
				payee: 'Power Co',
				cadence: 'monthly',
				expectedAmountCents: 4608,
				nextDate: '2026-07-14',
				status: 'suggested',
				source: 'imported',
				transactionCount: 3
			})
		]);
		await expect(generateRecurringSuggestions(db)).resolves.toEqual([]);
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

		const suggestions = await generateRecurringSuggestions(db);

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

		await expect(generateRecurringSuggestions(db)).resolves.toEqual([]);
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
		await expect(generateRecurringSuggestions(db)).resolves.toEqual([]);
	});
});

async function insertRecurringGroup(input: {
	accountId?: string | null;
	payee: string;
	cadence?: string;
	expectedAmountCents?: number;
	nextDate?: string | null;
	confidence?: number;
	categoryId?: string | null;
	direction?: 'incoming' | 'outgoing' | null;
}): Promise<string> {
	const id = crypto.randomUUID();
	await db
		.prepare(
			`INSERT INTO recurring_groups (
				id, account_id, category_id, payee, direction, cadence,
				expected_amount_cents, next_date, confidence
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
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

async function insertTransaction(input: {
	accountId: string;
	categoryId: string;
	payee: string;
	bookingDate: string;
	amountCents: number;
}) {
	await db
		.prepare(
			`INSERT INTO transactions (
				id, account_id, category_id, dedupe_key, booking_date,
				amount_cents, payee, search_text
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			crypto.randomUUID(),
			input.accountId,
			input.categoryId,
			`${input.payee}-${input.bookingDate}`,
			input.bookingDate,
			input.amountCents,
			input.payee,
			input.payee
		)
		.run();
}
