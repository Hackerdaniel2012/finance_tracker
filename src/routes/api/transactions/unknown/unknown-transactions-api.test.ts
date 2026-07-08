import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	applySql,
	createTestDatabase,
	createTestDbClient
} from '../../../../../tests/db/test-database';
import { createAccount, createProfile } from '$lib/server/accounts/repository';
import type { DbClient } from '$lib/server/db-client';
import { confirmImport } from '$lib/server/imports/confirm';
import { sha256Hex } from '$lib/server/imports/shared';
import { GET } from './+server';

let db: DbClient;

beforeEach(async () => {
	const sqlite = await createTestDatabase();
	applySql(sqlite, await readFile(resolve('migrations/0001_initial_schema.sql'), 'utf8'));
	applySql(sqlite, await readFile(resolve('migrations/0002_seed_default_categories.sql'), 'utf8'));
	db = createTestDbClient(sqlite);
});

describe('/api/transactions/unknown', () => {
	it('lists only unknown transactions with open review flags', async () => {
		await seedUnknownTransaction();

		const response = await GET(event());

		await expect(response.json()).resolves.toMatchObject({
			pagination: { total: 1 },
			transactions: [
				{
					payee: 'Cafe',
					classificationStatus: 'unknown',
					reviewFlag: { reason: 'unknown_category', status: 'open' }
				}
			]
		});
	});
});

function event() {
	return {
		platform: { env: { DB: db } },
		url: new URL('http://localhost/api/transactions/unknown')
	} as Parameters<typeof GET>[0];
}

async function seedUnknownTransaction() {
	const account = await createAccount(db, { name: 'DKB Giro' });
	const profile = await createProfile(db, {
		accountId: account.id,
		bankId: 'dkb',
		label: 'DKB CSV'
	});
	const csv = dkbCsv([
		'"09.07.26";"09.07.26";"Gebucht";"Me";"Cafe";"Coffee";"Ausgang";"DE";"4,00";"";"";"ref-cafe"'
	]);

	await confirmImport(db, {
		profileId: profile.id,
		csv,
		expectedHash: await sha256Hex(csv)
	});
}

function dkbCsv(rows: string[]): string {
	return [
		'"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"',
		...rows
	].join('\n');
}
