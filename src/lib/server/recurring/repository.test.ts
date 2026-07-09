import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	applySql,
	createTestDatabase,
	createTestDbClient
} from '../../../../tests/db/test-database';
import { createAccount, createProfile } from '../accounts/repository';
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
	applySql(sqlite, await readFile(resolve('migrations/0001_initial_schema.sql'), 'utf8'));
	applySql(sqlite, await readFile(resolve('migrations/0002_seed_default_categories.sql'), 'utf8'));
	db = createTestDbClient(sqlite);
});

describe('recurring repository', () => {
	it('lists and updates recurring groups', async () => {
		const account = await createAccount(db, { name: 'Main Giro' });
		const profile = await createProfile(db, {
			accountId: account.id,
			bankId: 'n26',
			label: 'N26 Main'
		});
		const id = await insertRecurringGroup({
			accountId: account.id,
			profileId: profile.id,
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
				profileLabel: 'N26 Main',
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
			profileId: null,
			payee: 'Warm Rent',
			status: 'confirmed',
			confidence: 100,
			source: 'confirmed_suggestion',
			nextDate: null
		});

		expect(updated).toMatchObject({
			id,
			accountId: null,
			profileId: null,
			payee: 'Warm Rent',
			status: 'confirmed',
			confidence: 100,
			source: 'confirmed_suggestion',
			nextDate: null
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
		const profile = await createProfile(db, {
			accountId: account.id,
			bankId: 'n26',
			label: 'N26 Main'
		});
		await insertTransaction({
			accountId: account.id,
			profileId: profile.id,
			categoryId: 'cat-utilities',
			payee: 'Power Co',
			bookingDate: '2026-04-15',
			amountCents: -4599
		});
		await insertTransaction({
			accountId: account.id,
			profileId: profile.id,
			categoryId: 'cat-utilities',
			payee: 'Power Co',
			bookingDate: '2026-05-15',
			amountCents: -4600
		});
		await insertTransaction({
			accountId: account.id,
			profileId: profile.id,
			categoryId: 'cat-utilities',
			payee: 'Power Co',
			bookingDate: '2026-06-14',
			amountCents: -4625
		});

		await expect(generateRecurringSuggestions(db)).resolves.toEqual([
			expect.objectContaining({
				accountId: account.id,
				profileId: profile.id,
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

	it('does not suggest recurring groups for fewer than three or unstable transactions', async () => {
		const account = await createAccount(db, { name: 'Main Giro' });
		const profile = await createProfile(db, {
			accountId: account.id,
			bankId: 'n26',
			label: 'N26 Main'
		});
		await insertTransaction({
			accountId: account.id,
			profileId: profile.id,
			categoryId: 'cat-utilities',
			payee: 'Two Count',
			bookingDate: '2026-05-01',
			amountCents: -2000
		});
		await insertTransaction({
			accountId: account.id,
			profileId: profile.id,
			categoryId: 'cat-utilities',
			payee: 'Two Count',
			bookingDate: '2026-06-01',
			amountCents: -2000
		});
		await insertTransaction({
			accountId: account.id,
			profileId: profile.id,
			categoryId: 'cat-utilities',
			payee: 'Irregular Co',
			bookingDate: '2026-04-01',
			amountCents: -3000
		});
		await insertTransaction({
			accountId: account.id,
			profileId: profile.id,
			categoryId: 'cat-utilities',
			payee: 'Irregular Co',
			bookingDate: '2026-05-01',
			amountCents: -3000
		});
		await insertTransaction({
			accountId: account.id,
			profileId: profile.id,
			categoryId: 'cat-utilities',
			payee: 'Irregular Co',
			bookingDate: '2026-05-12',
			amountCents: -3000
		});

		await expect(generateRecurringSuggestions(db)).resolves.toEqual([]);
	});
});

async function insertRecurringGroup(input: {
	accountId?: string | null;
	profileId?: string | null;
	payee: string;
	cadence?: string;
	expectedAmountCents?: number;
	nextDate?: string | null;
	confidence?: number;
}): Promise<string> {
	const id = crypto.randomUUID();
	await db
		.prepare(
			`INSERT INTO recurring_groups (
				id, account_id, profile_id, payee, cadence, expected_amount_cents,
				next_date, confidence
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			id,
			input.accountId ?? null,
			input.profileId ?? null,
			input.payee,
			input.cadence ?? 'monthly',
			input.expectedAmountCents ?? 1000,
			input.nextDate ?? '2026-07-31',
			input.confidence ?? 50
		)
		.run();

	return id;
}

async function insertTransaction(input: {
	accountId: string;
	profileId: string;
	categoryId: string;
	payee: string;
	bookingDate: string;
	amountCents: number;
}) {
	await db
		.prepare(
			`INSERT INTO transactions (
				id, profile_id, account_id, category_id, dedupe_key, booking_date,
				amount_cents, payee, search_text
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			crypto.randomUUID(),
			input.profileId,
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
