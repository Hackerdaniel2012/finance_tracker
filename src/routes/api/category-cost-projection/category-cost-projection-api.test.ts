import { beforeEach, describe, expect, it } from 'vitest';
import {
	applyMigrations,
	createTestDatabase,
	createTestDbClient
} from '../../../../tests/db/test-database';
import type { DbClient } from '$lib/server/db-client';
import { GET } from './+server';

let db: DbClient;

beforeEach(async () => {
	const sqlite = await createTestDatabase();
	await applyMigrations(sqlite);
	db = createTestDbClient(sqlite);
});

describe('/api/category-cost-projection', () => {
	it('returns an empty projection when no categories are selected', async () => {
		const response = await GET(
			event('http://localhost/api/category-cost-projection?asOf=2026-07-10')
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			projection: {
				range: { from: '2026-07-01', asOf: '2026-07-10', to: '2026-07-31' },
				categories: [],
				totals: { projectedCents: 0 }
			}
		});
	});

	it('deduplicates repeated expense categories', async () => {
		const response = await GET(
			event(
				'http://localhost/api/category-cost-projection?asOf=2026-07-10&categoryId=cat-groceries&categoryId=cat-groceries'
			)
		);

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			projection: { categories: [{ categoryId: 'cat-groceries' }] }
		});
	});

	it('rejects income and missing categories', async () => {
		for (const categoryId of ['cat-salary', 'missing']) {
			const response = await GET(
				event(
					`http://localhost/api/category-cost-projection?asOf=2026-07-10&categoryId=${categoryId}`
				)
			);
			expect(response.status).toBe(400);
			await expect(response.json()).resolves.toEqual({
				error: 'categoryId must reference expense or unknown categories'
			});
		}
	});
});

function event(url: string) {
	return {
		platform: { env: { DB: db } },
		url: new URL(url)
	} as Parameters<typeof GET>[0];
}
