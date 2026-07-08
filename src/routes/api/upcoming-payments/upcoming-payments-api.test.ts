import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	applySql,
	createTestDatabase,
	createTestDbClient
} from '../../../../tests/db/test-database';
import { createAccount } from '$lib/server/accounts/repository';
import type { DbClient } from '$lib/server/db-client';
import { createPlannedPayment } from '$lib/server/planned-cashflow/repository';
import { GET } from './+server';

let db: DbClient;

beforeEach(async () => {
	const sqlite = await createTestDatabase();
	applySql(sqlite, await readFile(resolve('migrations/0001_initial_schema.sql'), 'utf8'));
	applySql(sqlite, await readFile(resolve('migrations/0002_seed_default_categories.sql'), 'utf8'));
	db = createTestDbClient(sqlite);
});

describe('/api/upcoming-payments', () => {
	it('returns planned outgoing payments for the current month', async () => {
		const account = await createAccount(db, { name: 'Main Giro' });
		await createPlannedPayment(db, {
			accountId: account.id,
			payee: 'Power Co',
			amountCents: 9000,
			dueDate: '2026-07-10'
		});

		const response = await GET(event('http://localhost/api/upcoming-payments?asOf=2026-07-08'));

		await expect(response.json()).resolves.toMatchObject({
			upcomingPayments: [{ payee: 'Power Co', amountCents: 9000, dueDate: '2026-07-10' }]
		});
	});

	it('returns validation errors for bad asOf dates', async () => {
		const response = await GET(event('http://localhost/api/upcoming-payments?asOf=bad'));

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({ error: 'asOf must be an ISO date' });
	});

	it('returns validation errors for impossible asOf dates', async () => {
		const response = await GET(event('http://localhost/api/upcoming-payments?asOf=2026-02-31'));

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({ error: 'asOf must be an ISO date' });
	});
});

function event(url: string) {
	return {
		platform: { env: { DB: db } },
		url: new URL(url)
	} as Parameters<typeof GET>[0];
}
