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

describe('/api/contracts', () => {
	it('creates, lists, updates, and deletes contracts', async () => {
		const account = await createAccount(db, { name: 'Main Giro' });

		const createResponse = await POST(
			event({
				accountId: account.id,
				name: 'Internet',
				payee: 'Fiber Co',
				kind: 'fixed_cost',
				cadence: 'monthly',
				expectedAmountCents: 4999,
				nextDate: '2026-07-20'
			})
		);

		expect(createResponse.status).toBe(201);
		const created = (await createResponse.json()) as { contract: { id: string } };
		await expect((await GET(event())).json()).resolves.toMatchObject({
			contracts: [{ id: created.contract.id, name: 'Internet' }]
		});

		const patchResponse = await PATCH(
			event({ id: created.contract.id, status: 'paused', endDate: '2026-12-31' })
		);
		await expect(patchResponse.json()).resolves.toMatchObject({
			contract: { id: created.contract.id, status: 'paused', endDate: '2026-12-31' }
		});

		const deleteResponse = await DELETE(event({ id: created.contract.id }));
		await expect(deleteResponse.json()).resolves.toEqual({ ok: true });
		await expect((await GET(event())).json()).resolves.toEqual({ contracts: [] });
	});

	it('returns validation, missing link, missing contract, and malformed JSON errors', async () => {
		const invalid = await POST(
			event({
				name: 'Bad',
				kind: 'fixed_cost',
				cadence: 'monthly',
				expectedAmountCents: 0,
				nextDate: '2026-07-20'
			})
		);
		expect(invalid.status).toBe(400);
		await expect(invalid.json()).resolves.toEqual({
			error: 'expectedAmountCents must be a positive integer'
		});

		const invalidDate = await POST(
			event({
				name: 'Bad Date',
				kind: 'fixed_cost',
				cadence: 'monthly',
				expectedAmountCents: 1000,
				nextDate: '2026-02-31'
			})
		);
		expect(invalidDate.status).toBe(400);
		await expect(invalidDate.json()).resolves.toEqual({ error: 'nextDate must be an ISO date' });

		const missingAccount = await POST(
			event({
				accountId: 'missing',
				name: 'Rent',
				kind: 'fixed_cost',
				cadence: 'monthly',
				expectedAmountCents: 90000,
				nextDate: '2026-07-31'
			})
		);
		expect(missingAccount.status).toBe(404);
		await expect(missingAccount.json()).resolves.toEqual({ error: 'Account not found' });

		const missingContract = await PATCH(event({ id: 'missing', name: 'Nope' }));
		expect(missingContract.status).toBe(404);
		await expect(missingContract.json()).resolves.toEqual({ error: 'Contract not found' });

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
