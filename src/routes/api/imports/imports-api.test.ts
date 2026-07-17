import { beforeEach, describe, expect, it } from 'vitest';
import {
	applyMigrations,
	createTestDatabase,
	createTestDbClient,
	firstValue
} from '../../../../tests/db/test-database';
import { createAccount } from '$lib/server/accounts/repository';
import type { DbClient } from '$lib/server/db-client';
import { importIntoExistingAccount } from '$lib/server/imports/test-support';
import { sha256Hex } from '$lib/server/imports/shared';
import { GET } from './+server';

let db: DbClient;
let sqlite: Awaited<ReturnType<typeof createTestDatabase>>;

beforeEach(async () => {
	sqlite = await createTestDatabase();
	await applyMigrations(sqlite);
	db = createTestDbClient(sqlite);
});

describe('/api/imports', () => {
	it('lists import run metadata', async () => {
		const importAccount = await createDkbAccount();
		const csv = dkbCsv([
			'"08.07.26";"08.07.26";"Gebucht";"Me";"Shop";"Groceries";"Ausgang";"DE";"12,34";"";"";"ref-shop"'
		]);
		const report = await importIntoExistingAccount(db, {
			accountId: importAccount.accountId,
			adapterId: importAccount.bankId,
			csv,
			reportedBalanceCents: 0,
			expectedHash: await sha256Hex(csv)
		});

		const response = await GET(event());

		await expect(response.json()).resolves.toMatchObject({
			imports: [
				{
					id: report.runId,
					adapterId: 'dkb_girocard',
					rowCount: 1,
					importedCount: 1,
					accounts: [{ accountId: importAccount.accountId, accountName: 'DKB Giro' }]
				}
			]
		});
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM import_batches')).toBe(1);
	});
});

function event() {
	return {
		platform: { env: { DB: db } }
	} as Parameters<typeof GET>[0];
}

async function createDkbAccount() {
	const account = await createAccount(db, { name: 'DKB Giro' });
	return { ...account, accountId: account.id, bankId: 'dkb_girocard' as const };
}

function dkbCsv(rows: string[]): string {
	return [
		'"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"',
		...rows
	].join('\n');
}
