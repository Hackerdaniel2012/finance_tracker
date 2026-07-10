import { beforeEach, describe, expect, it } from 'vitest';
import {
	applyMigrations,
	createTestDatabase,
	createTestDbClient,
	firstValue
} from '../../../../tests/db/test-database';
import { createAccount, createProfile } from '$lib/server/accounts/repository';
import type { DbClient } from '$lib/server/db-client';
import { confirmImport } from '$lib/server/imports/confirm';
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
	it('lists import batch metadata', async () => {
		const profile = await createDkbProfile();
		const csv = dkbCsv([
			'"08.07.26";"08.07.26";"Gebucht";"Me";"Shop";"Groceries";"Ausgang";"DE";"12,34";"";"";"ref-shop"'
		]);
		const report = await confirmImport(db, {
			profileId: profile.id,
			csv,
			expectedHash: await sha256Hex(csv)
		});

		const response = await GET(event());

		await expect(response.json()).resolves.toMatchObject({
			imports: [
				{
					id: report.batchId,
					profileId: profile.id,
					accountName: 'DKB Giro',
					adapterId: 'dkb',
					rowCount: 1,
					importedCount: 1
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

async function createDkbProfile() {
	const account = await createAccount(db, { name: 'DKB Giro' });
	return createProfile(db, { accountId: account.id, bankId: 'dkb', label: 'DKB CSV' });
}

function dkbCsv(rows: string[]): string {
	return [
		'"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"',
		...rows
	].join('\n');
}
