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
import { DELETE, GET, PATCH, POST } from './+server';

let db: DbClient;

beforeEach(async () => {
	const sqlite = await createTestDatabase();
	applySql(sqlite, await readFile(resolve('migrations/0001_initial_schema.sql'), 'utf8'));
	applySql(sqlite, await readFile(resolve('migrations/0002_seed_default_categories.sql'), 'utf8'));
	db = createTestDbClient(sqlite);
});

describe('/api/liabilities', () => {
	it('creates, lists, updates, and deletes liabilities', async () => {
		const account = await createAccount(db, { name: 'Main Giro' });

		const createResponse = await POST(
			event({
				accountId: account.id,
				name: 'Credit Card',
				amountCents: 50000,
				asOfDate: '2026-07-08'
			})
		);

		expect(createResponse.status).toBe(201);
		const created = (await createResponse.json()) as { liability: { id: string } };
		await expect(GET(event())).resolves.toHaveProperty('status', 200);

		const patchResponse = await PATCH(
			event({ id: created.liability.id, status: 'cleared', note: 'Paid' })
		);
		await expect(patchResponse.json()).resolves.toMatchObject({
			liability: { id: created.liability.id, status: 'cleared', note: 'Paid' }
		});

		const deleteResponse = await DELETE(event({ id: created.liability.id }));
		await expect(deleteResponse.json()).resolves.toEqual({ ok: true });
		await expect((await GET(event())).json()).resolves.toEqual({ liabilities: [] });
	});

	it('returns validation, missing account, missing liability, and malformed JSON errors', async () => {
		const invalid = await POST(event({ name: 'Bad', amountCents: 0, asOfDate: '2026-07-08' }));
		expect(invalid.status).toBe(400);
		await expect(invalid.json()).resolves.toEqual({
			error: 'amountCents must be a positive integer'
		});

		const missingAccount = await POST(
			event({
				accountId: 'missing',
				name: 'Loan',
				amountCents: 1000,
				asOfDate: '2026-07-08'
			})
		);
		expect(missingAccount.status).toBe(404);
		await expect(missingAccount.json()).resolves.toEqual({ error: 'Account not found' });

		const missingLiability = await PATCH(event({ id: 'missing', name: 'Nope' }));
		expect(missingLiability.status).toBe(404);
		await expect(missingLiability.json()).resolves.toEqual({ error: 'Liability not found' });

		const malformed = await POST(eventWithMalformedJson());
		expect(malformed.status).toBe(400);
		await expect(malformed.json()).resolves.toEqual({ error: 'Request body must be valid JSON' });
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
