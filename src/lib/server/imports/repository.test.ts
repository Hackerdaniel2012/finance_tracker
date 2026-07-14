import { beforeEach, describe, expect, it } from 'vitest';
import {
	applyMigrations,
	createTestDatabase,
	createTestDbClient,
	firstValue
} from '../../../../tests/db/test-database';
import { createAccount } from '../accounts/repository';
import type { DbClient } from '../db-client';
import { createPlan, getPlan } from '../plans/repository';
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

	it('rebuilds recurring plan state when deleting older and newer matched imports', async () => {
		const importAccount = await createDkbAccount();
		const plan = await createPlan(db, {
			accountId: importAccount.accountId,
			direction: 'expense',
			cadence: 'monthly',
			amountCents: 1234,
			nextDate: '2026-07-08',
			counterparty: 'Shop'
		});
		const julyCsv = dkbCsv([
			'"08.07.26";"08.07.26";"Gebucht";"Me";"Shop";"Plan";"Ausgang";"DE";"12,34";"";"";"plan-july"'
		]);
		const augustCsv = dkbCsv([
			'"08.08.26";"08.08.26";"Gebucht";"Me";"Shop";"Plan";"Ausgang";"DE";"12,34";"";"";"plan-august"'
		]);
		const july = await confirmImport(db, {
			accountId: importAccount.accountId,
			adapterId: importAccount.bankId,
			csv: julyCsv,
			expectedHash: await sha256Hex(julyCsv)
		});
		const august = await confirmImport(db, {
			accountId: importAccount.accountId,
			adapterId: importAccount.bankId,
			csv: augustCsv,
			expectedHash: await sha256Hex(augustCsv)
		});
		expect((await getPlan(db, plan.id))?.nextDate).toBe('2026-09-08');

		await deleteImportBatch(db, july.batchId);
		expect((await getPlan(db, plan.id))?.nextDate).toBe('2026-09-08');
		expect((await getPlan(db, plan.id))?.transactionCount).toBe(1);

		await deleteImportBatch(db, august.batchId);
		expect((await getPlan(db, plan.id))?.nextDate).toBe('2026-07-08');
		expect((await getPlan(db, plan.id))?.status).toBe('active');
		expect((await getPlan(db, plan.id))?.transactionCount).toBe(0);
	});

	it('restores a liability balance when its matched import is deleted', async () => {
		const importAccount = await createDkbAccount();
		await db
			.prepare(
				`INSERT INTO category_rules (id, category_id, name, field, operator, pattern, priority, is_global)
				VALUES ('loan-test-rule', 'cat-installment-plan', 'Loan test', 'payee', 'equals', 'Loan Bank', 1000, 1)`
			)
			.run();
		const plan = await createPlan(db, {
			accountId: importAccount.accountId,
			direction: 'expense',
			cadence: 'monthly',
			amountCents: 1234,
			nextDate: '2026-07-08',
			counterparty: 'Loan Bank',
			liability: {
				name: 'Loan',
				amountCents: 10000,
				asOfDate: '2026-07-01',
				annualInterestRateBps: 0
			}
		});
		const csv = dkbCsv([
			'"08.07.26";"08.07.26";"Gebucht";"Me";"Loan Bank";"Rate";"Ausgang";"DE";"12,34";"";"";"loan-july"'
		]);
		const report = await confirmImport(db, {
			accountId: importAccount.accountId,
			adapterId: importAccount.bankId,
			csv,
			expectedHash: await sha256Hex(csv)
		});
		expect(firstValue<number>(sqlite, 'SELECT amount_cents FROM marked_liabilities')).toBe(8766);

		await deleteImportBatch(db, report.batchId);
		expect(firstValue<number>(sqlite, 'SELECT amount_cents FROM marked_liabilities')).toBe(10000);
		expect((await getPlan(db, plan.id))?.nextDate).toBe('2026-07-08');
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
