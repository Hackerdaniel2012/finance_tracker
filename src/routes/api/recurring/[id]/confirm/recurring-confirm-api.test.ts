import { beforeEach, describe, expect, it } from 'vitest';
import {
	applyMigrations,
	createTestDatabase,
	createTestDbClient,
	firstValue
} from '../../../../../../tests/db/test-database';
import type { DbClient } from '$lib/server/db-client';
import { POST } from './+server';

let db: DbClient;
let sqlite: Awaited<ReturnType<typeof createTestDatabase>>;

beforeEach(async () => {
	sqlite = await createTestDatabase();
	await applyMigrations(sqlite);
	db = createTestDbClient(sqlite);
});

describe('/api/recurring/:id/confirm', () => {
	it('confirms using all stored suggestion values', async () => {
		const id = await insertSuggestion('outgoing');

		const response = await POST(event(id, {}));

		expect(response.status).toBe(201);
		await expect(response.json()).resolves.toMatchObject({
			plan: {
				categoryId: 'cat-utilities',
				direction: 'expense',
				cadence: 'monthly',
				amountCents: 2500,
				nextDate: '2026-08-01',
				source: 'recurring_suggestion',
				sourceRecurringGroupId: id
			}
		});
		expect(
			firstValue<string>(sqlite, `SELECT status FROM recurring_groups WHERE id = '${id}'`)
		).toBe('confirmed');
	});

	it('creates a liability from stored outgoing values and rejects stored incoming values', async () => {
		const outgoing = await insertSuggestion('outgoing');
		const liability = {
			name: 'Loan',
			amountCents: 100000,
			asOfDate: '2026-07-14',
			annualInterestRateBps: 500
		};

		const created = await POST(event(outgoing, { liability }));
		expect(created.status).toBe(201);
		await expect(created.json()).resolves.toMatchObject({
			plan: { categoryId: 'cat-installment-plan', liabilityId: expect.any(String) }
		});

		const incoming = await insertSuggestion('incoming');
		const rejected = await POST(event(incoming, { liability }));
		expect(rejected.status).toBe(400);
		await expect(rejected.json()).resolves.toEqual({
			error: 'Liabilities can only be created from outgoing suggestions'
		});
		expect(
			firstValue<string>(sqlite, `SELECT status FROM recurring_groups WHERE id = '${incoming}'`)
		).toBe('suggested');
	});

	it('rejects status and source overrides', async () => {
		for (const override of [{ status: 'ignored' }, { source: 'manual' }]) {
			const id = await insertSuggestion('outgoing');
			const response = await POST(event(id, override));
			expect(response.status).toBe(400);
			await expect(response.json()).resolves.toEqual({
				error: 'Confirmation cannot override recurring status or source'
			});
		}
	});
});

async function insertSuggestion(direction: 'incoming' | 'outgoing'): Promise<string> {
	const id = crypto.randomUUID();
	await db
		.prepare(
			`INSERT INTO recurring_groups (
				id, category_id, payee, direction, cadence, expected_amount_cents, next_date, confidence
			) VALUES (?, 'cat-utilities', 'Service', ?, 'monthly', 2500, '2026-08-01', 90)`
		)
		.bind(id, direction)
		.run();
	return id;
}

function event(id: string, body: unknown) {
	return {
		params: { id },
		platform: { env: { DB: db } },
		request: { json: async () => body }
	} as Parameters<typeof POST>[0];
}
