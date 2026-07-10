import { beforeEach, describe, expect, it } from 'vitest';
import {
	applyMigrations,
	createTestDatabase,
	createTestDbClient
} from '../../../../../tests/db/test-database';
import type { DbClient } from '$lib/server/db-client';
import { POST } from './+server';

let db: DbClient;

beforeEach(async () => {
	const sqlite = await createTestDatabase();
	await applyMigrations(sqlite);
	db = createTestDbClient(sqlite);
	await db.prepare("INSERT INTO accounts (id, name) VALUES ('account-1', 'Main')").run();
	await db
		.prepare(
			"INSERT INTO import_profiles (id, account_id, bank_id, label) VALUES ('profile-1', 'account-1', 'n26', 'Main')"
		)
		.run();
	await db
		.prepare(
			"INSERT INTO transactions (id, profile_id, account_id, dedupe_key, booking_date, amount_cents, payee, search_text) VALUES ('txn-1', 'profile-1', 'account-1', 'one', '2026-07-01', -500, 'Cafe Central', 'Cafe Central')"
		)
		.run();
});

describe('/api/category-rules/preview', () => {
	it('previews matching unknown transactions', async () => {
		const response = await POST({
			platform: { env: { DB: db } },
			request: {
				json: async () => ({
					categoryId: 'cat-leisure',
					name: 'Cafe rule',
					field: 'payee',
					operator: 'contains',
					pattern: 'Cafe',
					priority: 100,
					isGlobal: true
				})
			}
		} as Parameters<typeof POST>[0]);
		await expect(response.json()).resolves.toMatchObject({
			matchCount: 1,
			sample: [{ id: 'txn-1', payee: 'Cafe Central', amountCents: -500 }]
		});
	});
});
