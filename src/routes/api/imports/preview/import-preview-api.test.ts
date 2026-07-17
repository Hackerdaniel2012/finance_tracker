import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	applyMigrations,
	createTestDatabase,
	createTestDbClient
} from '../../../../../tests/db/test-database';
import type { DbClient } from '$lib/server/db-client';
import { POST } from './+server';

let db: DbClient;
beforeEach(async () => {
	const sqlite = await createTestDatabase();
	await applyMigrations(sqlite);
	db = createTestDbClient(sqlite);
});

describe('/api/imports/preview', () => {
	it('discovers CSV accounts without requiring a target account', async () => {
		const csv = await readFile(resolve('tests/fixtures/dkb-giro-basic.csv'), 'utf8');
		const response = await POST(event(form(csv)));
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			preview: {
				adapterId: 'dkb_girocard',
				readyToConfirm: false,
				summary: { accountCount: 1, parsedRows: 3 }
			}
		});
	});

	it('requires a file', async () => {
		const response = await POST(event(form()));
		expect(response.status).toBe(400);
	});

	it.each([
		['null assignment', '[null]'],
		[
			'numeric account name',
			JSON.stringify([
				{
					sourceAccountKey: null,
					newAccount: { name: 123, institution: null },
					balanceMode: 'complete_history'
				}
			])
		]
	])('rejects malformed assignment objects: %s', async (_label, assignments) => {
		const csv = await readFile(resolve('tests/fixtures/dkb-giro-basic.csv'), 'utf8');
		const data = form(csv);
		data.set('assignments', assignments);
		const response = await POST(event(data));
		expect(response.status).toBe(400);
	});
});

function form(csv?: string): FormData {
	const data = new FormData();
	data.set('adapterId', 'dkb_girocard');
	if (csv !== undefined) data.set('file', new Blob([csv], { type: 'text/csv' }), 'bank.csv');
	return data;
}
function event(body: FormData) {
	return {
		platform: { env: { DB: db } },
		request: new Request('http://localhost/api/imports/preview', { method: 'POST', body })
	} as Parameters<typeof POST>[0];
}
