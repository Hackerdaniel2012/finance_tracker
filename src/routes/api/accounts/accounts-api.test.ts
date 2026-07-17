import { beforeEach, describe, expect, it } from 'vitest';
import {
	applyMigrations,
	createTestDatabase,
	createTestDbClient
} from '../../../../tests/db/test-database';
import type { DbClient } from '$lib/server/db-client';
import { createAccount } from '$lib/server/accounts/repository';
import { DELETE, GET, PATCH, POST } from './+server';

let db: DbClient;

beforeEach(async () => {
	const sqlite = await createTestDatabase();
	await applyMigrations(sqlite);
	db = createTestDbClient(sqlite);
});

describe('/api/accounts', () => {
	it('lists an empty account set', async () => {
		const response = await GET(event());

		await expect(response.json()).resolves.toEqual({ accounts: [] });
	});

	it('creates and updates accounts', async () => {
		const createResponse = await POST(
			event({
				name: 'Main Giro',
				institution: 'DKB'
			})
		);

		expect(createResponse.status).toBe(201);
		const created = (await createResponse.json()) as {
			account: {
				id: string;
				name: string;
				institution: string;
			};
		};
		expect(created.account).toMatchObject({
			name: 'Main Giro',
			institution: 'DKB'
		});

		const patchResponse = await PATCH(event({ id: created.account.id, name: 'Household Giro' }));
		await expect(patchResponse.json()).resolves.toMatchObject({
			account: { id: created.account.id, name: 'Household Giro' }
		});
	});

	it('preserves custom and empty institutions', async () => {
		const customResponse = await POST(event({ name: 'Custom Bank', institution: 'Custom Bank' }));
		const customPayload = (await customResponse.json()) as {
			account: { institution: string | null };
		};
		expect(customPayload.account.institution).toBe('Custom Bank');

		const emptyResponse = await POST(event({ name: 'No Institution' }));
		const emptyPayload = (await emptyResponse.json()) as {
			account: { institution: string | null };
		};
		expect(emptyPayload.account.institution).toBeNull();
	});

	it('deletes accounts and their linked data', async () => {
		const account = await createAccount(db, { name: 'Disposable DKB' });

		const response = await DELETE(event({ id: account.id }));

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ ok: true });
		expect(
			await db.prepare('SELECT id FROM accounts WHERE id = ?').bind(account.id).first()
		).toBeNull();
	});

	it('returns validation and not found errors', async () => {
		const invalidCreate = await POST(event({ name: '' }));
		expect(invalidCreate.status).toBe(400);
		await expect(invalidCreate.json()).resolves.toEqual({ error: 'name is required' });
		const legacyBalance = await POST(event({ name: 'Legacy', currentBalanceCents: 100 }));
		expect(legacyBalance.status).toBe(400);

		const missingPatch = await PATCH(event({ id: 'missing', name: 'Nope' }));
		expect(missingPatch.status).toBe(404);
		await expect(missingPatch.json()).resolves.toEqual({ error: 'Account not found' });
	});

	it('returns validation errors for malformed JSON', async () => {
		const response = await POST(eventWithMalformedJson());

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({ error: 'Request body must be valid JSON' });
	});

	it('does not expose source account keys as account filters', async () => {
		const account = await createAccount(db, { name: 'N26' });
		await db
			.prepare(
				`INSERT INTO transactions (
					id, account_id, dedupe_key, booking_date, amount_cents, search_text, source_account_key
				) VALUES (?, ?, ?, ?, ?, ?, ?)`
			)
			.bind('txn-1', account.id, 'dedupe-1', '2026-07-08', -100, 'coffee', 'Hauptkonto')
			.run();
		await db
			.prepare(
				`INSERT INTO transactions (
					id, account_id, dedupe_key, booking_date, amount_cents, search_text, source_account_key
				) VALUES (?, ?, ?, ?, ?, ?, ?)`
			)
			.bind('txn-2', account.id, 'dedupe-2', '2026-07-09', -200, 'groceries', '20k in 2023')
			.run();

		const response = await GET(event());

		const payload = (await response.json()) as { accounts: Array<Record<string, unknown>> };
		expect(payload).toMatchObject({ accounts: [{ id: account.id, balanceCents: null, balanceInitialized: false }] });
		expect(payload.accounts[0]).not.toHaveProperty('subaccounts');
	});
});

function event(body?: unknown) {
	return {
		platform: { env: { DB: db } },
		request: {
			json: async () => body
		}
	} as Parameters<typeof GET>[0] &
		Parameters<typeof POST>[0] &
		Parameters<typeof PATCH>[0] &
		Parameters<typeof DELETE>[0];
}

function eventWithMalformedJson() {
	return {
		platform: { env: { DB: db } },
		request: {
			json: async () => {
				throw new SyntaxError('Unexpected token');
			}
		}
	} as unknown as Parameters<typeof POST>[0];
}
