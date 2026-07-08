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

describe('/api/planned-income', () => {
	it('creates, lists, updates, and deletes planned income', async () => {
		const account = await createAccount(db, { name: 'Main Giro' });
		const createResponse = await POST(
			event({
				accountId: account.id,
				categoryId: 'cat-salary',
				payer: 'Employer',
				amountCents: 250000,
				dueDate: '2026-07-25'
			})
		);

		expect(createResponse.status).toBe(201);
		const created = (await createResponse.json()) as { plannedIncome: { id: string } };
		await expect((await GET(event())).json()).resolves.toMatchObject({
			plannedIncome: [{ id: created.plannedIncome.id, payer: 'Employer' }]
		});

		await expect(
			(await PATCH(event({ id: created.plannedIncome.id, status: 'received' }))).json()
		).resolves.toMatchObject({ plannedIncome: { status: 'received' } });
		await expect((await DELETE(event({ id: created.plannedIncome.id }))).json()).resolves.toEqual({
			ok: true
		});
	});

	it('returns validation, not found, and malformed JSON errors', async () => {
		const invalid = await POST(event({ payer: 'Bad', amountCents: 0, dueDate: '2026-07-25' }));
		expect(invalid.status).toBe(400);
		await expect(invalid.json()).resolves.toEqual({
			error: 'amountCents must be a positive integer'
		});

		const missing = await PATCH(event({ id: 'missing', status: 'received' }));
		expect(missing.status).toBe(404);
		await expect(missing.json()).resolves.toEqual({ error: 'Planned income not found' });

		const malformed = await POST(eventWithMalformedJson());
		expect(malformed.status).toBe(400);
		await expect(malformed.json()).resolves.toEqual({ error: 'Request body must be valid JSON' });
	});
});

function event(body?: unknown) {
	return {
		platform: { env: { DB: db } },
		request: { json: async () => body }
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
