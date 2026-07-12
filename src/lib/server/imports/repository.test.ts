import { beforeEach, describe, expect, it } from 'vitest';
import {
	applyMigrations,
	createTestDatabase,
	createTestDbClient,
	firstValue
} from '../../../../tests/db/test-database';
import { createAccount } from '../accounts/repository';
import type { DbClient } from '../db-client';
import { confirmImport } from './confirm';
import { deleteImportBatch, listImportBatches } from './repository';
import { sha256Hex } from './shared';

let db: DbClient;
let sqlite: Awaited<ReturnType<typeof createTestDatabase>>;

beforeEach(async () => {
	sqlite = await createTestDatabase();
	await applyMigrations(sqlite);
	db = createTestDbClient(sqlite);
});

describe('import batch repository', () => {
	it('lists import batch metadata with account context', async () => {
		const importAccount = await createDkbAccount();
		const csv = dkbCsv([
			'"08.07.26";"08.07.26";"Gebucht";"Me";"Shop";"Groceries";"Ausgang";"DE";"12,34";"";"";"ref-shop"'
		]);
		const report = await confirmImport(db, {
			accountId: importAccount.accountId,
			adapterId: importAccount.bankId,
			csv,
			expectedHash: await sha256Hex(csv)
		});

		const batches = await listImportBatches(db);

		expect(batches).toEqual([
			expect.objectContaining({
				id: report.batchId,
				accountId: importAccount.accountId,
				accountName: 'DKB Giro',
				adapterId: 'dkb_girocard',
				rowCount: 1,
				importedCount: 1,
				duplicateCount: 0,
				errorCount: 0
			})
		]);
		expect(batches[0]?.fileHash).toMatch(/^[a-f0-9]{64}$/);
	});

	it('deletes a batch and cascades imported transactions and errors', async () => {
		const importAccount = await createDkbAccount();
		const csv = dkbCsv([
			'"08.07.26";"08.07.26";"Gebucht";"Me";"Shop";"Groceries";"Ausgang";"DE";"12,34";"";"";"ref-shop"',
			'"09.07.26";"09.07.26";"Gebucht";"Me";"Bad";"Broken";"Ausgang";"DE";"not-money";"";"";"ref-bad"'
		]);
		const report = await confirmImport(db, {
			accountId: importAccount.accountId,
			adapterId: importAccount.bankId,
			csv,
			expectedHash: await sha256Hex(csv)
		});

		await deleteImportBatch(db, report.batchId);

		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM import_batches')).toBe(0);
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM transactions')).toBe(0);
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM import_row_errors')).toBe(0);
	});

	it('returns not found errors for missing batches', async () => {
		await expect(deleteImportBatch(db, 'missing')).rejects.toThrow('Import batch not found');
		await expect(deleteImportBatch(db, '   ')).rejects.toThrow('Import batch not found');
	});
});

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
