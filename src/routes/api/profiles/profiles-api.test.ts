import { beforeEach, describe, expect, it } from 'vitest';
import {
	applyMigrations,
	createTestDatabase,
	createTestDbClient
} from '../../../../tests/db/test-database';
import type { DbClient } from '$lib/server/db-client';
import { createAccount } from '$lib/server/accounts/repository';
import { GET, POST } from './+server';

let db: DbClient;

beforeEach(async () => {
	const sqlite = await createTestDatabase();
	await applyMigrations(sqlite);
	db = createTestDbClient(sqlite);
});

describe('/api/profiles', () => {
	it('lists an empty profile set', async () => {
		const response = await GET(event());

		await expect(response.json()).resolves.toEqual({ profiles: [] });
	});

	it('creates import profiles', async () => {
		const account = await createAccount(db, { name: 'DKB Giro' });
		const response = await POST(
			event({ accountId: account.id, bankId: 'dkb', label: 'DKB CSV Profile' })
		);

		expect(response.status).toBe(201);
		await expect(response.json()).resolves.toMatchObject({
			profile: { accountId: account.id, bankId: 'dkb', label: 'DKB CSV Profile' }
		});
	});

	it('returns validation, missing account, and duplicate profile errors', async () => {
		const invalid = await POST(event({ accountId: 'account-1', bankId: 'bad', label: 'Bad' }));
		expect(invalid.status).toBe(400);

		const missing = await POST(event({ accountId: 'missing', bankId: 'dkb', label: 'DKB' }));
		expect(missing.status).toBe(404);
		await expect(missing.json()).resolves.toEqual({ error: 'Account not found' });

		const account = await createAccount(db, { name: 'N26' });
		await POST(event({ accountId: account.id, bankId: 'n26', label: 'N26 CSV' }));
		const duplicate = await POST(
			event({ accountId: account.id, bankId: 'dkb', label: 'Duplicate' })
		);
		expect(duplicate.status).toBe(409);
		await expect(duplicate.json()).resolves.toEqual({
			error: 'Account already has an import profile'
		});
	});

	it('returns validation errors for malformed JSON', async () => {
		const response = await POST(eventWithMalformedJson());

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({ error: 'Request body must be valid JSON' });
	});
});

function event(body?: unknown) {
	return {
		platform: { env: { DB: db } },
		request: {
			json: async () => body
		}
	} as Parameters<typeof GET>[0] & Parameters<typeof POST>[0];
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
