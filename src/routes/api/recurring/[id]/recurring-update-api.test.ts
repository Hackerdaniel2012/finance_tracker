import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	applySql,
	createTestDatabase,
	createTestDbClient
} from '../../../../../tests/db/test-database';
import type { DbClient } from '$lib/server/db-client';
import { PATCH } from './+server';

let db: DbClient;

beforeEach(async () => {
	const sqlite = await createTestDatabase();
	applySql(sqlite, await readFile(resolve('migrations/0001_initial_schema.sql'), 'utf8'));
	applySql(sqlite, await readFile(resolve('migrations/0002_seed_default_categories.sql'), 'utf8'));
	db = createTestDbClient(sqlite);
});

describe('/api/recurring/:id', () => {
	it('updates recurring groups', async () => {
		const id = await insertRecurringGroup();

		const response = await PATCH(event(id, { status: 'confirmed', confidence: 100 }));

		await expect(response.json()).resolves.toMatchObject({
			recurringGroup: { id, status: 'confirmed', confidence: 100 }
		});
	});

	it('returns validation, missing group, and malformed JSON errors', async () => {
		const id = await insertRecurringGroup();

		const invalid = await PATCH(event(id, { confidence: 101 }));
		expect(invalid.status).toBe(400);
		await expect(invalid.json()).resolves.toEqual({
			error: 'confidence must be an integer between 0 and 100'
		});

		const invalidDate = await PATCH(event(id, { nextDate: '2026-02-31' }));
		expect(invalidDate.status).toBe(400);
		await expect(invalidDate.json()).resolves.toEqual({ error: 'nextDate must be an ISO date' });

		const empty = await PATCH(event(id, {}));
		expect(empty.status).toBe(400);
		await expect(empty.json()).resolves.toEqual({
			error: 'At least one recurring group field must be updated'
		});

		const missing = await PATCH(event('missing', { status: 'ignored' }));
		expect(missing.status).toBe(404);
		await expect(missing.json()).resolves.toEqual({ error: 'Recurring group not found' });

		const malformed = await PATCH(eventWithMalformedJson(id));
		expect(malformed.status).toBe(400);
		await expect(malformed.json()).resolves.toEqual({ error: 'Request body must be valid JSON' });
	});
});

async function insertRecurringGroup(): Promise<string> {
	const id = crypto.randomUUID();
	await db
		.prepare(
			`INSERT INTO recurring_groups (
				id, payee, cadence, expected_amount_cents, next_date, confidence
			) VALUES (?, 'Rent', 'monthly', 90000, '2026-07-31', 90)`
		)
		.bind(id)
		.run();

	return id;
}

function event(id: string, body: unknown) {
	return {
		params: { id },
		platform: { env: { DB: db } },
		request: {
			json: async () => body
		}
	} as Parameters<typeof PATCH>[0];
}

function eventWithMalformedJson(id: string) {
	return {
		params: { id },
		platform: { env: { DB: db } },
		request: {
			json: async () => {
				throw new SyntaxError('Unexpected token');
			}
		}
	} as unknown as Parameters<typeof PATCH>[0];
}
