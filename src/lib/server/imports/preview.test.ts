import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	applyMigrations,
	createTestDatabase,
	createTestDbClient,
	firstValue
} from '../../../../tests/db/test-database';
import { createAccount } from '../accounts/repository';
import type { DbClient } from '../db-client';
import { previewImport } from './preview';

let db: DbClient;
let sqlite: Awaited<ReturnType<typeof createTestDatabase>>;

beforeEach(async () => {
	sqlite = await createTestDatabase();
	await applyMigrations(sqlite);
	db = createTestDbClient(sqlite);
});

describe('previewImport', () => {
	it('parses a importAccount CSV without writing import state', async () => {
		const importAccount = await createDkbAccount();
		const csv = await readFile(resolve('tests/fixtures/dkb-giro-basic.csv'), 'utf8');

		const preview = await previewImport(db, {
			accountId: importAccount.accountId,
			adapterId: importAccount.bankId,
			csv
		});

		expect(preview).toMatchObject({
			accountId: importAccount.accountId,
			adapterId: 'dkb_girocard',
			summary: {
				errorCount: 0,
				duplicateEstimate: 0,
				startDate: '2026-07-01',
				endDate: '2026-07-03'
			},
			metadata: {
				Girokonto: 'DE00000000000000000000'
			}
		});
		expect(preview.fileHash).toMatch(/^[a-f0-9]{64}$/);
		expect(preview.sampleRows).toHaveLength(3);
		expect(preview.summary.parsedRows).toBe(3);
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM import_batches')).toBe(0);
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM transactions')).toBe(0);
	});

	it('estimates duplicates by importAccount and dedupe key', async () => {
		const importAccount = await createDkbAccount();
		const csv = [
			'"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"',
			'"08.07.26";"08.07.26";"Gebucht";"Me";"Shop";"Groceries";"Ausgang";"DE";"12,34";"";"";"ref-1"',
			'"09.07.26";"09.07.26";"Gebucht";"Me";"Cafe";"Coffee";"Ausgang";"DE";"4,00";"";"";"ref-2"'
		].join('\n');
		await insertTransaction(importAccount.accountId, 'dkb_ref:ref-1|2026-07-08|2026-07-08|-1234');

		const preview = await previewImport(db, {
			accountId: importAccount.accountId,
			adapterId: importAccount.bankId,
			csv
		});

		expect(preview.summary.duplicateEstimate).toBe(1);
		expect(preview.duplicateRows).toMatchObject([
			{
				reason: 'existing_transaction',
				transaction: { bookingDate: '2026-07-08', amountCents: -1234, payee: 'Shop' },
				existingTransaction: { bookingDate: '2026-07-08', amountCents: -1234, payee: null }
			}
		]);
	});

	it('lists repeated rows in the uploaded file as duplicates', async () => {
		const importAccount = await createDkbAccount();
		const csv = [
			'"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"',
			'"08.07.26";"08.07.26";"Gebucht";"Me";"Shop";"Groceries";"Ausgang";"DE";"12,34";"";"";"ref-1"',
			'"08.07.26";"08.07.26";"Gebucht";"Me";"Shop";"Groceries";"Ausgang";"DE";"12,34";"";"";"ref-1"'
		].join('\n');

		const preview = await previewImport(db, {
			accountId: importAccount.accountId,
			adapterId: importAccount.bankId,
			csv
		});

		expect(preview.summary.duplicateEstimate).toBe(1);
		expect(preview.duplicateRows).toMatchObject([
			{ reason: 'duplicate_in_file', transaction: { source: { rowNumber: 3 } } }
		]);
	});

	it('previews exclusive per-subaccount combinations without writing data', async () => {
		const importAccount = await createN26Account();
		const csv = n26Csv([
			'2025-12-01,,Old Credit,DE,"Credit Transfer",Old,Main,10.00,,,',
			'2025-12-02,,Old Debit,DE,"Debit Transfer",Old,Main,-10.00,,,',
			'2025-12-03,,Old Space,DE,"Debit Transfer",Old,Savings,-5.00,,,',
			'2026-01-01,,Current,DE,"Credit Transfer",Current,Main,20.00,,,'
		]);

		const preview = await previewImport(db, {
			accountId: importAccount.accountId,
			adapterId: importAccount.bankId,
			csv,
			combineBeforeDate: '2026-01-01'
		});

		expect(preview).toMatchObject({
			combineBeforeDate: '2026-01-01',
			summary: {
				combinedSourceCount: 3,
				combinedRecordCount: 2,
				detailedImportCount: 1,
				effectiveImportCount: 3
			},
			combinedRows: [
				{ subaccount: 'Main', bookingDate: '2025-12-31', amountCents: 0, sourceRowCount: 2 },
				{
					subaccount: 'Savings',
					bookingDate: '2025-12-31',
					amountCents: -500,
					sourceRowCount: 1
				}
			]
		});
		expect(preview.sampleRows).toHaveLength(1);
		expect(preview.sampleRows[0]?.bookingDate).toBe('2026-01-01');
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM import_batches')).toBe(0);
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM import_source_fingerprints')).toBe(0);
	});

	it('rejects malformed and future combination dates', async () => {
		const importAccount = await createDkbAccount();
		await expect(
			previewImport(db, {
				accountId: importAccount.accountId,
				adapterId: importAccount.bankId,
				csv: 'csv',
				combineBeforeDate: 'not-a-date'
			})
		).rejects.toThrow('combineBeforeDate must be an ISO date');
		await expect(
			previewImport(db, {
				accountId: importAccount.accountId,
				adapterId: importAccount.bankId,
				csv: 'csv',
				combineBeforeDate: '2999-01-01'
			})
		).rejects.toThrow('combineBeforeDate cannot be in the future');
	});

	it('rejects missing profiles and empty CSV content', async () => {
		await expect(
			previewImport(db, { accountId: 'missing', adapterId: 'dkb_girocard', csv: 'x' })
		).rejects.toThrow('Account not found');
		await expect(
			previewImport(db, { accountId: 'account-1', adapterId: 'dkb_girocard', csv: '   ' })
		).rejects.toThrow('CSV file is required');
	});
});

async function createDkbAccount() {
	const account = await createAccount(db, { name: 'DKB Giro' });
	return { ...account, accountId: account.id, bankId: 'dkb_girocard' as const };
}

async function createN26Account() {
	const account = await createAccount(db, { name: 'N26 Main' });
	return { ...account, accountId: account.id, bankId: 'n26' as const };
}

function n26Csv(rows: string[]): string {
	return [
		'"Booking Date","Value Date","Partner Name","Partner Iban",Type,"Payment Reference","Account Name","Amount (EUR)","Original Amount","Original Currency","Exchange Rate"',
		...rows
	].join('\n');
}

async function insertTransaction(accountId: string, dedupeKey: string) {
	await db
		.prepare(
			`INSERT INTO transactions (
				id, account_id, dedupe_key, booking_date, amount_cents, search_text
			) VALUES (?, ?, ?, ?, ?, ?)`
		)
		.bind(crypto.randomUUID(), accountId, dedupeKey, '2026-07-08', -1234, 'shop')
		.run();
}
