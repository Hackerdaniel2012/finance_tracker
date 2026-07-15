import { beforeEach, describe, expect, it } from 'vitest';
import {
	applyMigrations,
	createTestDatabase,
	createTestDbClient
} from '../../../../../tests/db/test-database';
import { createAccount } from '$lib/server/accounts/repository';
import type { DbClient } from '$lib/server/db-client';
import { sha256Hex } from '$lib/server/imports/shared';
import { POST } from './+server';

let db: DbClient;

beforeEach(async () => {
	const sqlite = await createTestDatabase();
	await applyMigrations(sqlite);
	db = createTestDbClient(sqlite);
});

describe('/api/imports/confirm', () => {
	it('confirms a multipart CSV import', async () => {
		const account = await createAccount(db, { name: 'DKB Giro' });
		const csv = dkbCsv([
			'"08.07.26";"08.07.26";"Gebucht";"Me";"Shop";"Groceries";"Ausgang";"DE";"12,34";"";"";"ref-shop"'
		]);

		const response = await POST(event(form(account.id, csv, await sha256Hex(csv), '2026-07-09')));

		expect(response.status).toBe(201);
		await expect(response.json()).resolves.toMatchObject({
			report: {
				accountId: account.id,
				adapterId: 'dkb_girocard',
				combineBeforeDate: '2026-07-09',
				rowCount: 1,
				importedCount: 1,
				combinedSourceCount: 1,
				combinedRecordCount: 1,
				detailedImportCount: 0,
				duplicateCount: 0,
				errorCount: 0,
				unknownCount: 0
			}
		});
	});

	it('returns validation errors for hash mismatch, missing files, and malformed form data', async () => {
		const mismatch = await POST(event(form('importAccount-1', 'csv', 'bad')));
		expect(mismatch.status).toBe(400);
		await expect(mismatch.json()).resolves.toEqual({
			error: 'File hash does not match preview'
		});

		const missingFile = await POST(event(form('importAccount-1', undefined, 'hash')));
		expect(missingFile.status).toBe(400);
		await expect(missingFile.json()).resolves.toEqual({ error: 'file is required' });

		const malformed = await POST(eventWithMalformedFormData());
		expect(malformed.status).toBe(400);
		await expect(malformed.json()).resolves.toEqual({
			error: 'Request body must be multipart form data'
		});
	});
});

function form(
	accountId: string,
	csv: string | undefined,
	expectedHash: string,
	combineBeforeDate?: string
): FormData {
	const data = new FormData();
	data.set('accountId', accountId);
	data.set('adapterId', 'dkb_girocard');
	data.set('expectedHash', expectedHash);
	if (combineBeforeDate) data.set('combineBeforeDate', combineBeforeDate);

	if (csv !== undefined) {
		data.set('file', new Blob([csv], { type: 'text/csv' }), 'bank.csv');
	}

	return data;
}

function event(body: FormData) {
	return {
		platform: { env: { DB: db } },
		request: new Request('http://localhost/api/imports/confirm', {
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

function dkbCsv(rows: string[]): string {
	return [
		'"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"',
		...rows
	].join('\n');
}
