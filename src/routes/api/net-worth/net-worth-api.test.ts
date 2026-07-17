import { beforeEach, describe, expect, it } from 'vitest';
import {
	applyMigrations,
	createTestDatabase,
	createTestDbClient
} from '../../../../tests/db/test-database';
import { createAccount } from '$lib/server/accounts/repository';
import type { DbClient } from '$lib/server/db-client';
import { GET } from './+server';

let db: DbClient;

beforeEach(async () => {
	const sqlite = await createTestDatabase();
	await applyMigrations(sqlite);
	db = createTestDbClient(sqlite);
});

describe('/api/net-worth', () => {
	it('returns net worth accounts, liabilities, and points', async () => {
		const account = await createAccount(db, { name: 'Savings' });
		await addSnapshot(account.id, 125000);
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
						date: '2026-07-01',
						assetsCents: 125000,
						liabilitiesCents: 25000,
						netWorthCents: 100000
					},
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

	it('filters net worth by account id', async () => {
		const checking = await createAccount(db, { name: 'Checking' });
		const savings = await createAccount(db, { name: 'Savings' });
		await addSnapshot(checking.id, 100000);
		await addSnapshot(savings.id, 200000);
		await db
			.prepare(
				`INSERT INTO marked_liabilities (id, account_id, name, amount_cents, as_of_date)
				VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)`
			)
			.bind(
				'liability-checking',
				checking.id,
				'Card',
				25000,
				'2026-07-01',
				'liability-savings',
				savings.id,
				'Loan',
				50000,
				'2026-07-01'
			)
			.run();

		const response = await GET(
			event(`http://localhost/api/net-worth?from=2026-07-01&to=2026-07-31&accountId=${checking.id}`)
		);

		await expect(response.json()).resolves.toMatchObject({
			netWorth: {
				accounts: [{ accountId: checking.id, accountName: 'Checking', balanceCents: 100000 }],
				liabilities: [{ id: 'liability-checking', name: 'Card', amountCents: 25000 }],
				points: [
					{
						date: '2026-07-01',
						assetsCents: 100000,
						liabilitiesCents: 25000,
						netWorthCents: 75000
					},
					{
						date: '2026-07-31',
						assetsCents: 100000,
						liabilitiesCents: 25000,
						netWorthCents: 75000
					}
				]
			}
		});
	});
});

async function addSnapshot(accountId: string, balanceCents: number) {
	await db
		.prepare(
			`INSERT INTO account_balance_snapshots (id, account_id, snapshot_date, balance_cents, source)
			VALUES (?, ?, '2026-07-01', ?, 'manual')`
		)
		.bind(crypto.randomUUID(), accountId, balanceCents)
		.run();
}

function event(url: string) {
	return {
		platform: { env: { DB: db } },
		url: new URL(url)
	} as Parameters<typeof GET>[0];
}
