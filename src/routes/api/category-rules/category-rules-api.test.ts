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

describe('/api/category-rules', () => {
	it('lists an empty rule set', async () => {
		const response = await GET(event());

		await expect(response.json()).resolves.toEqual({ rules: [] });
	});

	it('creates and updates rules', async () => {
		const createResponse = await POST(
			event({
				categoryId: 'cat-groceries',
				name: 'Grocery stores',
				field: 'payee',
				operator: 'contains',
				pattern: 'REWE',
				priority: 10
			})
		);

		expect(createResponse.status).toBe(201);
		const created = (await createResponse.json()) as { rule: { id: string } };
		const patchResponse = await PATCH(
			event({ id: created.rule.id, pattern: 'EDEKA', isGlobal: false })
		);

		await expect(patchResponse.json()).resolves.toMatchObject({
			rule: { id: created.rule.id, pattern: 'EDEKA', isGlobal: false }
		});
	});

	it('returns validation, not found, and malformed JSON errors', async () => {
		const invalid = await POST(
			event({
				categoryId: 'cat-groceries',
				name: 'Bad',
				field: 'amount',
				operator: 'contains',
				pattern: 'x'
			})
		);
		expect(invalid.status).toBe(400);
		await expect(invalid.json()).resolves.toEqual({
			error: 'field must be one of payee, description, note, search_text'
		});

		const missingCategory = await POST(
			event({
				categoryId: 'missing',
				name: 'Missing',
				field: 'payee',
				operator: 'contains',
				pattern: 'x'
			})
		);
		expect(missingCategory.status).toBe(404);
		await expect(missingCategory.json()).resolves.toEqual({ error: 'Category not found' });

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
