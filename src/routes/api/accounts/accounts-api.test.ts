import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	applySql,
	createTestDatabase,
	createTestDbClient
} from '../../../../tests/db/test-database';
import type { DbClient } from '$lib/server/db-client';
import { createAccount } from '$lib/server/accounts/repository';
import { DELETE, GET, PATCH, POST } from './+server';

let db: DbClient;

beforeEach(async () => {
	const sqlite = await createTestDatabase();
	applySql(sqlite, await readFile(resolve('migrations/0001_initial_schema.sql'), 'utf8'));
	db = createTestDbClient(sqlite);
});

describe('/api/accounts', () => {
	it('lists an empty account set', async () => {
		const response = await GET(event());

		await expect(response.json()).resolves.toEqual({ accounts: [] });
	});

	it('creates and updates accounts', async () => {
		const createResponse = await POST(
			event({ name: 'Main Giro', institution: 'DKB', openingBalanceCents: 12345 })
		);

		expect(createResponse.status).toBe(201);
		const created = (await createResponse.json()) as {
			account: { id: string; name: string; institution: string; openingBalanceCents: number };
		};
		expect(created.account).toMatchObject({
			name: 'Main Giro',
			institution: 'DKB',
			openingBalanceCents: 12345
		});

		const patchResponse = await PATCH(event({ id: created.account.id, name: 'Household Giro' }));
		await expect(patchResponse.json()).resolves.toMatchObject({
			account: { id: created.account.id, name: 'Household Giro' }
		});
	});

	it('deletes accounts and their linked data', async () => {
		const account = await createAccount(db, { name: 'Disposable DKB' });
		await db
			.prepare('INSERT INTO import_profiles (id, account_id, bank_id, label) VALUES (?, ?, ?, ?)')
			.bind('profile-to-delete', account.id, 'dkb', 'Disposable DKB')
			.run();

		const response = await DELETE(event({ id: account.id }));

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ ok: true });
		expect(
			await db.prepare('SELECT id FROM accounts WHERE id = ?').bind(account.id).first()
		).toBeNull();
		expect(
			await db
				.prepare('SELECT id FROM import_profiles WHERE account_id = ?')
				.bind(account.id)
				.first()
		).toBeNull();
	});

	it('returns validation and not found errors', async () => {
		const invalidCreate = await POST(event({ name: '' }));
		expect(invalidCreate.status).toBe(400);
		await expect(invalidCreate.json()).resolves.toEqual({ error: 'name is required' });

		const missingPatch = await PATCH(event({ id: 'missing', name: 'Nope' }));
		expect(missingPatch.status).toBe(404);
		await expect(missingPatch.json()).resolves.toEqual({ error: 'Account not found' });
	});

	it('returns validation errors for malformed JSON', async () => {
		const response = await POST(eventWithMalformedJson());

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({ error: 'Request body must be valid JSON' });
	});

	it('includes linked profile data in account list', async () => {
		const account = await createAccount(db, { name: 'Brokerage' });
		await db
			.prepare('INSERT INTO import_profiles (id, account_id, bank_id, label) VALUES (?, ?, ?, ?)')
			.bind('profile-1', account.id, 'trade_republic', 'Trade Republic')
			.run();

		const response = await GET(event());

		await expect(response.json()).resolves.toMatchObject({
			accounts: [{ id: account.id, profile: { id: 'profile-1', bankId: 'trade_republic' } }]
		});
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
