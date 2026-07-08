import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	applySql,
	createTestDatabase,
	createTestDbClient
} from '../../../../tests/db/test-database';
import type { DbClient } from '$lib/server/db-client';
import { GET, PATCH, POST } from './+server';

let db: DbClient;

beforeEach(async () => {
	const sqlite = await createTestDatabase();
	applySql(sqlite, await readFile(resolve('migrations/0001_initial_schema.sql'), 'utf8'));
	applySql(sqlite, await readFile(resolve('migrations/0002_seed_default_categories.sql'), 'utf8'));
	db = createTestDbClient(sqlite);
});

describe('/api/categories', () => {
	it('lists seeded categories', async () => {
		const response = await GET(event());

		await expect(response.json()).resolves.toMatchObject({
			categories: expect.arrayContaining([
				expect.objectContaining({
					id: 'cat-income',
					name: 'Income',
					type: 'income',
					isDefault: true
				}),
				expect.objectContaining({
					id: 'cat-salary',
					name: 'Salary',
					type: 'income',
					isDefault: true
				})
			])
		});
	});

	it('creates and updates categories', async () => {
		const createResponse = await POST(
			event({ name: 'Education', type: 'expense', color: '#0f766e', icon: 'graduation-cap' })
		);

		expect(createResponse.status).toBe(201);
		const created = (await createResponse.json()) as { category: { id: string } };
		const patchResponse = await PATCH(
			event({ id: created.category.id, name: 'Learning', sortOrder: 42 })
		);

		await expect(patchResponse.json()).resolves.toMatchObject({
			category: { id: created.category.id, name: 'Learning', sortOrder: 42 }
		});
	});

	it('returns validation and not found errors', async () => {
		const invalid = await POST(event({ name: 'Bad', type: 'bad' }));
		expect(invalid.status).toBe(400);
		await expect(invalid.json()).resolves.toEqual({
			error: 'type must be one of income, expense, transfer, investment, unknown'
		});

		const missing = await PATCH(event({ id: 'missing', name: 'Missing' }));
		expect(missing.status).toBe(404);
		await expect(missing.json()).resolves.toEqual({ error: 'Category not found' });

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
	} as Parameters<typeof GET>[0] & Parameters<typeof POST>[0] & Parameters<typeof PATCH>[0];
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
