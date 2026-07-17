import { beforeEach, describe, expect, it } from 'vitest';
import {
	applyMigrations,
	createTestDatabase,
	createTestDbClient,
	firstValue
} from '../../../../../tests/db/test-database';
import { createAccount } from '$lib/server/accounts/repository';
import type { DbClient } from '$lib/server/db-client';
import { importIntoExistingAccount } from '$lib/server/imports/test-support';
import { sha256Hex } from '$lib/server/imports/shared';
import { DELETE } from './+server';

let db: DbClient;
let sqlite: Awaited<ReturnType<typeof createTestDatabase>>;

beforeEach(async () => {
	sqlite = await createTestDatabase();
	await applyMigrations(sqlite);
	db = createTestDbClient(sqlite);
});

describe('/api/imports/:id', () => {
	it('deletes import batches', async () => {
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

		const response = await DELETE(event(report.runId));

		await expect(response.json()).resolves.toEqual({ ok: true });
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM import_batches')).toBe(0);
	});

	it('returns not found errors for missing runs', async () => {
		const response = await DELETE(event('missing'));

		expect(response.status).toBe(404);
		await expect(response.json()).resolves.toEqual({ error: 'Import run not found' });
	});

	it('requires imports to be deleted newest first', async () => {
		const importAccount = await createDkbAccount();
		const firstCsv = dkbCsv([
			'"08.07.26";"08.07.26";"Gebucht";"Me";"Shop";"First";"Ausgang";"DE";"1,00";"";"";"first"'
		]);
		const first = await importIntoExistingAccount(db, {
			accountId: importAccount.accountId,
			adapterId: importAccount.bankId,
			csv: firstCsv,
			reportedBalanceCents: 1000,
			expectedHash: await sha256Hex(firstCsv)
		});
		const secondCsv = dkbCsv([
			'"09.07.26";"09.07.26";"Gebucht";"Me";"Shop";"Second";"Ausgang";"DE";"1,00";"";"";"second"'
		]);
		await importIntoExistingAccount(db, {
			accountId: importAccount.accountId,
			adapterId: importAccount.bankId,
			csv: secondCsv,
			reportedBalanceCents: 900,
			expectedHash: await sha256Hex(secondCsv)
		});

		const response = await DELETE(event(first.runId));
		expect(response.status).toBe(409);
		await expect(response.json()).resolves.toEqual({
			error: 'Newer imports must be deleted first'
		});
	});
});

function event(id: string) {
	return {
		params: { id },
		platform: { env: { DB: db } }
	} as Parameters<typeof DELETE>[0];
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
