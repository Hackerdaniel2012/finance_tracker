import { beforeEach, describe, expect, it } from 'vitest';
import {
	applyMigrations,
	createTestDatabase,
	createTestDbClient
} from '../../../../tests/db/test-database';
import { createAccount } from '$lib/server/accounts/repository';
import type { DbClient } from '$lib/server/db-client';
import { DELETE, GET, PATCH, POST } from './+server';

let db: DbClient;

beforeEach(async () => {
	const sqlite = await createTestDatabase();
	await applyMigrations(sqlite);
	db = createTestDbClient(sqlite);
});

describe('/api/planned-payments', () => {
	it('creates, lists, updates, and deletes planned payments', async () => {
		const account = await createAccount(db, { name: 'Main Giro' });
		const createResponse = await POST(
			event({
				accountId: account.id,
				categoryId: 'cat-utilities',
				payee: 'Power Co',
				amountCents: 8900,
				dueDate: '2026-07-15'
			})
		);

		expect(createResponse.status).toBe(201);
		const created = (await createResponse.json()) as { plannedPayment: { id: string } };
		await expect((await GET(event())).json()).resolves.toMatchObject({
			plannedPayments: [{ id: created.plannedPayment.id, payee: 'Power Co' }]
		});

		await expect(
			(await PATCH(event({ id: created.plannedPayment.id, status: 'paid' }))).json()
		).resolves.toMatchObject({ plannedPayment: { status: 'paid' } });
		await expect((await DELETE(event({ id: created.plannedPayment.id }))).json()).resolves.toEqual({
			ok: true
		});
	});

	it('returns validation, not found, and malformed JSON errors', async () => {
		const invalid = await POST(event({ payee: 'Bad', amountCents: 0, dueDate: '2026-07-15' }));
		expect(invalid.status).toBe(400);
		await expect(invalid.json()).resolves.toEqual({
			error: 'amountCents must be a positive integer'
		});

		const missing = await PATCH(event({ id: 'missing', status: 'paid' }));
		expect(missing.status).toBe(404);
		await expect(missing.json()).resolves.toEqual({ error: 'Planned payment not found' });

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
