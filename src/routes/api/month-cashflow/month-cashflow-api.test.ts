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

describe('/api/month-cashflow', () => {
	it('returns a calendar-month report', async () => {
		const response = await GET(event('http://localhost/api/month-cashflow?asOf=2026-07-08'));

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			monthCashflow: {
				range: { from: '2026-07-01', asOf: '2026-07-08', to: '2026-07-31' },
				actual: { incomeCents: 0, expenseCents: 0, netCents: 0 },
				forecast: { incomeCents: 0, paymentCents: 0, netCents: 0 },
				projectedNetCents: 0
			}
		});
	});

	it.each([
		['asOf=not-a-date', 'asOf must be an ISO date'],
		['accountId=', 'accountId must not be empty']
	])('validates query parameters', async (query, message) => {
		const response = await GET(event(`http://localhost/api/month-cashflow?${query}`));

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({ error: message });
	});
});

function event(url: string) {
	return {
		platform: { env: { DB: db } },
		url: new URL(url)
	} as Parameters<typeof GET>[0];
}
