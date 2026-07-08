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
import { createPlannedIncome } from '$lib/server/planned-cashflow/repository';
import { GET } from './+server';

let db: DbClient;

beforeEach(async () => {
	const sqlite = await createTestDatabase();
	applySql(sqlite, await readFile(resolve('migrations/0001_initial_schema.sql'), 'utf8'));
	applySql(sqlite, await readFile(resolve('migrations/0002_seed_default_categories.sql'), 'utf8'));
	db = createTestDbClient(sqlite);
});

describe('/api/upcoming-income', () => {
	it('returns planned incoming income for the current month', async () => {
		const account = await createAccount(db, { name: 'Main Giro' });
		await createPlannedIncome(db, {
			accountId: account.id,
			payer: 'Employer',
			amountCents: 250000,
			dueDate: '2026-07-25'
		});

		const response = await GET(event('http://localhost/api/upcoming-income?asOf=2026-07-08'));

		await expect(response.json()).resolves.toMatchObject({
			upcomingIncome: [{ payer: 'Employer', amountCents: 250000, dueDate: '2026-07-25' }]
		});
	});
});

function event(url: string) {
	return {
		platform: { env: { DB: db } },
		url: new URL(url)
	} as Parameters<typeof GET>[0];
}
