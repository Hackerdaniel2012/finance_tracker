import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	applyMigrations,
	createTestDatabase,
	createTestDbClient
} from '../../../../../tests/db/test-database';
import { createAccount } from '$lib/server/accounts/repository';
import type { DbClient } from '$lib/server/db-client';
import { POST } from './+server';

let db: DbClient;

beforeEach(async () => {
	const sqlite = await createTestDatabase();
	await applyMigrations(sqlite);
	db = createTestDbClient(sqlite);
});

describe('/api/imports/preview', () => {
	it('returns an import preview for multipart CSV uploads', async () => {
		const account = await createAccount(db, { name: 'DKB Giro' });
		const importAccount = { ...account, accountId: account.id, bankId: 'dkb_girocard' as const };
		const csv = await readFile(resolve('tests/fixtures/dkb-giro-basic.csv'), 'utf8');

		const response = await POST(event(form(account.id, csv)));

		await expect(response.json()).resolves.toMatchObject({
			preview: {
				accountId: account.id,
				adapterId: 'dkb_girocard',
				summary: {
					errorCount: 0,
					duplicateEstimate: 0,
					startDate: '2026-07-01',
					endDate: '2026-07-03'
				}
			}
		});
	});

	it('returns validation errors for missing files and malformed form data', async () => {
		const missingFile = await POST(event(form('importAccount-1')));
		expect(missingFile.status).toBe(400);
		await expect(missingFile.json()).resolves.toEqual({ error: 'file is required' });

		const malformed = await POST(eventWithMalformedFormData());
		expect(malformed.status).toBe(400);
		await expect(malformed.json()).resolves.toEqual({
			error: 'Request body must be multipart form data'
		});
	});
});

function form(accountId: string, csv?: string): FormData {
	const data = new FormData();
	data.set('accountId', accountId);
	data.set('adapterId', 'dkb_girocard');

	if (csv !== undefined) {
		data.set('file', new Blob([csv], { type: 'text/csv' }), 'bank.csv');
	}

	return data;
}

function event(body: FormData) {
	return {
		platform: { env: { DB: db } },
		request: new Request('http://localhost/api/imports/preview', {
			method: 'POST',
			body
		})
	} as Parameters<typeof POST>[0];
}

function eventWithMalformedFormData() {
	return {
		platform: { env: { DB: db } },
		request: {
			formData: async () => {
				throw new TypeError('Bad boundary');
			}
		}
	} as unknown as Parameters<typeof POST>[0];
}
