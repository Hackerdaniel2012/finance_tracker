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
import { GET } from './+server';

let db: DbClient;

beforeEach(async () => {
	const sqlite = await createTestDatabase();
	applySql(sqlite, await readFile(resolve('migrations/0001_initial_schema.sql'), 'utf8'));
	applySql(sqlite, await readFile(resolve('migrations/0002_seed_default_categories.sql'), 'utf8'));
	db = createTestDbClient(sqlite);
});

describe('/api/net-worth', () => {
	it('returns net worth accounts, liabilities, and points', async () => {
		const account = await createAccount(db, {
			name: 'Savings',
			openingBalanceCents: 100000,
			currentBalanceCents: 125000
		});
		await db
			.prepare(
				`INSERT INTO marked_liabilities (id, account_id, name, amount_cents, as_of_date)
				VALUES (?, ?, ?, ?, ?)`
			)
			.bind('liability-1', account.id, 'Card', 25000, '2026-07-01')
			.run();

		const response = await GET(
			event('http://localhost/api/net-worth?from=2026-07-01&to=2026-07-31')
		);

		await expect(response.json()).resolves.toMatchObject({
			netWorth: {
				accounts: [{ accountName: 'Savings', balanceCents: 125000 }],
				liabilities: [{ id: 'liability-1', name: 'Card', amountCents: 25000 }],
				points: [
					{
						date: '2026-07-31',
						assetsCents: 125000,
						liabilitiesCents: 25000,
						netWorthCents: 100000
					}
				]
			}
		});
	});
});

function event(url: string) {
	return {
		platform: { env: { DB: db } },
		url: new URL(url)
	} as Parameters<typeof GET>[0];
}
