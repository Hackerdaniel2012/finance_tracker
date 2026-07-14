import { describe, expect, it } from 'vitest';
import { GET, PATCH, POST } from './+server';
import {
	applyMigrations,
	createTestDatabase,
	createTestDbClient
} from '../../../../tests/db/test-database';
import type { DbClient } from '$lib/server/db-client';

function event(db: DbClient, body?: unknown): Parameters<typeof POST>[0] {
	return { platform: { env: { DB: db } }, request: { json: async () => body } } as never;
}

describe('/api/plans', () => {
	it('creates and lists a plan', async () => {
		const database = await createTestDatabase();
		await applyMigrations(database);
		const db = createTestDbClient(database);
		const created = await POST(
			event(db, {
				direction: 'expense',
				cadence: 'once',
				amountCents: 100,
				nextDate: '2026-07-20',
				counterparty: 'Test'
			})
		);
		expect(created.status).toBe(201);
		const listed = await GET(event(db));
		expect(((await listed.json()) as { plans: unknown[] }).plans).toHaveLength(1);
	});

	it('rejects direct liability attachment through generic plan CRUD', async () => {
		const database = await createTestDatabase();
		await applyMigrations(database);
		const db = createTestDbClient(database);
		const createResponse = await POST(
			event(db, {
				direction: 'expense',
				cadence: 'monthly',
				amountCents: 100,
				nextDate: '2026-07-20',
				liabilityId: 'arbitrary'
			})
		);
		expect(createResponse.status).toBe(400);
		await expect(createResponse.json()).resolves.toEqual({
			error: 'liabilityId can only be managed through liability plan operations'
		});

		const patchResponse = await PATCH(
			event(db, { id: 'plan', liabilityId: 'arbitrary' }) as Parameters<typeof PATCH>[0]
		);
		expect(patchResponse.status).toBe(400);
	});

	it('rejects recurring suggestion provenance through generic plan creation', async () => {
		const database = await createTestDatabase();
		await applyMigrations(database);
		const db = createTestDbClient(database);
		for (const provenance of [
			{ source: 'recurring_suggestion' },
			{ sourceRecurringGroupId: 'suggestion' }
		]) {
			const response = await POST(
				event(db, {
					direction: 'expense',
					cadence: 'monthly',
					amountCents: 100,
					nextDate: '2026-07-20',
					...provenance
				})
			);
			expect(response.status).toBe(400);
			await expect(response.json()).resolves.toEqual({
				error: 'Recurring suggestion provenance can only be managed through the confirm endpoint'
			});
		}
		expect(database.exec('SELECT COUNT(*) FROM plans')[0]?.values).toEqual([[0]]);
	});

	it('creates a recurring plan and linked liability atomically', async () => {
		const database = await createTestDatabase();
		await applyMigrations(database);
		const db = createTestDbClient(database);
		const response = await POST(
			event(db, {
				direction: 'expense',
				cadence: 'monthly',
				amountCents: 9951,
				nextDate: '2026-07-30',
				endDate: null,
				label: 'Car loan',
				liability: {
					name: 'Car loan',
					amountCents: 553411,
					asOfDate: '2026-07-01',
					annualInterestRateBps: 363
				}
			})
		);

		expect(response.status).toBe(201);
		const payload = (await response.json()) as {
			plan: { liabilityId: string; categoryId: string; endDate: string | null };
		};
		expect(payload.plan.categoryId).toBe('cat-installment-plan');
		expect(payload.plan.endDate).toBeNull();
		expect(payload.plan.liabilityId).toBeTruthy();
		expect(
			database.exec(
				`SELECT name, amount_cents, annual_interest_rate_bps FROM marked_liabilities WHERE id = '${payload.plan.liabilityId}'`
			)[0]?.values
		).toEqual([['Car loan', 553411, 363]]);
	});
});
