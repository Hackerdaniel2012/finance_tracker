import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	applySql,
	createTestDatabase,
	createTestDbClient
} from '../../../../tests/db/test-database';
import type { DbClient } from '$lib/server/db-client';
import { GET } from './+server';

let db: DbClient;

beforeEach(async () => {
	const sqlite = await createTestDatabase();
	applySql(sqlite, await readFile(resolve('migrations/0001_initial_schema.sql'), 'utf8'));
	applySql(sqlite, await readFile(resolve('migrations/0002_seed_default_categories.sql'), 'utf8'));
	db = createTestDbClient(sqlite);
});

describe('/api/recurring', () => {
	it('returns recurring groups', async () => {
		await insertRecurringGroup('Rent');

		const response = await GET(event());

		await expect(response.json()).resolves.toMatchObject({
			recurringGroups: [{ payee: 'Rent', cadence: 'monthly', status: 'suggested' }]
		});
	});
});

async function insertRecurringGroup(payee: string): Promise<void> {
	await db
		.prepare(
			`INSERT INTO recurring_groups (
				id, payee, cadence, expected_amount_cents, next_date, confidence
			) VALUES (?, ?, 'monthly', 90000, '2026-07-31', 90)`
		)
		.bind(crypto.randomUUID(), payee)
		.run();
}

function event() {
	return {
		platform: { env: { DB: db } }
	} as Parameters<typeof GET>[0];
}
