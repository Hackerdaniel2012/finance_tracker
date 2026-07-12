import { beforeEach, describe, expect, it } from 'vitest';
import {
	applyMigrations,
	createTestDatabase,
	createTestDbClient
} from '../../../../../tests/db/test-database';
import { createAccount } from '$lib/server/accounts/repository';
import type { DbClient } from '$lib/server/db-client';
import { confirmImport } from '$lib/server/imports/confirm';
import { sha256Hex } from '$lib/server/imports/shared';
import { GET } from './+server';

let db: DbClient;

beforeEach(async () => {
	const sqlite = await createTestDatabase();
	await applyMigrations(sqlite);
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
	const importAccount = { ...account, accountId: account.id, bankId: 'dkb_girocard' as const };
	const csv = dkbCsv([
		'"09.07.26";"09.07.26";"Gebucht";"Me";"Cafe";"Coffee";"Ausgang";"DE";"4,00";"";"";"ref-cafe"'
	]);

	await confirmImport(db, {
		accountId: importAccount.accountId,
		adapterId: importAccount.bankId,
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
