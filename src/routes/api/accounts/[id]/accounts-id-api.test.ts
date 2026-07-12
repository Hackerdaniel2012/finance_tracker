import { beforeEach, describe, expect, it } from 'vitest';
import {
	applyMigrations,
	createTestDatabase,
	createTestDbClient,
	firstValue
} from '../../../../../tests/db/test-database';
import { createAccount } from '$lib/server/accounts/repository';
import type { DbClient } from '$lib/server/db-client';
import { DELETE, GET } from './+server';

let db: DbClient;
let sqlite: Awaited<ReturnType<typeof createTestDatabase>>;

beforeEach(async () => {
	sqlite = await createTestDatabase();
	await applyMigrations(sqlite);
	db = createTestDbClient(sqlite);
});

describe('/api/accounts/:id', () => {
	it('returns an account by id', async () => {
		const account = await createAccount(db, { name: 'Main Giro', institution: 'DKB' });

		const response = await GET(event(account.id));

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			account: { id: account.id, name: 'Main Giro', institution: 'DKB' }
		});
	});

	it('returns not found for unknown ids', async () => {
		const response = await GET(event('missing'));

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toEqual({ error: 'Account not found' });
	});

	it('deletes an account and its linked data', async () => {
		const account = await createAccount(db, { name: 'Disposable DKB' });
		const importAccount = { ...account, accountId: account.id, bankId: 'dkb_girocard' as const };
		await db
			.prepare(
				`INSERT INTO transactions (
					id, account_id, dedupe_key, booking_date, amount_cents, search_text
				) VALUES (?, ?, ?, ?, ?, ?)`
			)
			.bind('txn-1', account.id, 'dedupe-1', '2026-07-08', -100, 'coffee')
			.run();

		const response = await DELETE(event(account.id));

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ ok: true });
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM accounts')).toBe(0);
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM transactions')).toBe(0);
	});

	it('returns not found when deleting an unknown account', async () => {
		const response = await DELETE(event('missing'));

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toEqual({ error: 'Account not found' });
	});
});

function event(id: string) {
	return {
		params: { id },
		platform: { env: { DB: db } }
	} as Parameters<typeof GET>[0] & Parameters<typeof DELETE>[0];
}
