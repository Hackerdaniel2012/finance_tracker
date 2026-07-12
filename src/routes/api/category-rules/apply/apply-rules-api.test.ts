import { beforeEach, describe, expect, it } from 'vitest';
import {
	applyMigrations,
	createTestDatabase,
	createTestDbClient,
	firstValue
} from '../../../../../tests/db/test-database';
import type { DbClient } from '$lib/server/db-client';
import { POST } from './+server';

let db: DbClient;
let sqlite: Awaited<ReturnType<typeof createTestDatabase>>;

beforeEach(async () => {
	sqlite = await createTestDatabase();
	await applyMigrations(sqlite);
	db = createTestDbClient(sqlite);
});

describe('/api/category-rules/apply', () => {
	it('re-applies seeded rules to existing transactions and resolves review flags', async () => {
		db.prepare("INSERT INTO accounts (id, name) VALUES ('account-1', 'Main')").run();
		db.prepare(
			`INSERT INTO transactions (
				id, account_id, dedupe_key, booking_date, amount_cents, payee, description, search_text, category_id, classification_status
			) VALUES
				('txn-1', 'account-1', 'd1', '2026-07-01', -1234, 'REWE Markt', 'Presentment Hauptkonto', 'rewe markt presentment hauptkonto', NULL, 'unknown'),
				('txn-2', 'account-1', 'd2', '2026-07-02', 250000, 'Biontech SE', 'Lohn Gehalt', 'biontech se lohn gehalt', NULL, 'unknown'),
				('txn-3', 'account-1', 'd3', '2026-07-03', -999, 'Cafe', 'Coffee', 'cafe coffee', 'cat-leisure', 'auto')`
		).run();
		db.prepare(
			"INSERT INTO transaction_review_flags (id, transaction_id, reason) VALUES ('flag-1', 'txn-1', 'unknown_category'), ('flag-2', 'txn-2', 'unknown_category')"
		).run();

		const response = await POST(event());
		const body = (await response.json()) as {
			result: { updatedCount: number; matchedCount: number; unmatchedCount: number };
		};

		expect(response.status).toBe(200);
		expect(body.result).toMatchObject({
			updatedCount: 3,
			matchedCount: 2,
			unmatchedCount: 1
		});
		expect(
			firstValue<string>(sqlite, "SELECT category_id FROM transactions WHERE id = 'txn-1'")
		).toBe('cat-groceries');
		expect(
			firstValue<string>(sqlite, "SELECT category_id FROM transactions WHERE id = 'txn-2'")
		).toBe('cat-salary');
		expect(
			firstValue<string>(sqlite, "SELECT category_id FROM transactions WHERE id = 'txn-3'")
		).toBeNull();
		expect(
			firstValue<number>(
				sqlite,
				"SELECT COUNT(*) FROM transaction_review_flags WHERE status = 'open'"
			)
		).toBe(1);
	});

	it('leaves manually classified transactions unchanged', async () => {
		db.prepare("INSERT INTO accounts (id, name) VALUES ('account-1', 'Main')").run();
		db.prepare(
			`INSERT INTO transactions (
				id, account_id, dedupe_key, booking_date, amount_cents, payee, search_text, category_id, classification_status
			) VALUES ('txn-1', 'account-1', 'd1', '2026-07-01', -1234, 'REWE Markt', 'rewe markt', 'cat-leisure', 'manual')`
		).run();

		const response = await POST(event());
		const body = (await response.json()) as {
			result: { updatedCount: number; matchedCount: number; unmatchedCount: number };
		};

		expect(body.result).toMatchObject({ updatedCount: 0, matchedCount: 0, unmatchedCount: 0 });
		expect(
			firstValue<string>(sqlite, "SELECT category_id FROM transactions WHERE id = 'txn-1'")
		).toBe('cat-leisure');
	});
});

function event() {
	return {
		platform: { env: { DB: db } },
		request: { json: async () => ({}) }
	} as Parameters<typeof POST>[0];
}
