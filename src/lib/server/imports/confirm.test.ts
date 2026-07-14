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
import { createCategoryRule } from '../categories/repository';
import type { DbClient, DbRunResult, DbStatement, DbValue } from '../db-client';
import { confirmImport } from './confirm';
import { sha256Hex } from './shared';

let db: DbClient;
let sqlite: Awaited<ReturnType<typeof createTestDatabase>>;

beforeEach(async () => {
	sqlite = await createTestDatabase();
	await applyMigrations(sqlite);
	db = createTestDbClient(sqlite);
});

describe('confirmImport', () => {
	it('inserts parsed transactions, applies rules, and flags unknown rows', async () => {
		const importAccount = await createDkbAccount();
		await createCategoryRule(db, {
			categoryId: 'cat-groceries',
			name: 'Shop payee',
			field: 'payee',
			operator: 'contains',
			pattern: 'Shop',
			priority: 10
		});
		const csv = dkbCsv([
			'"08.07.26";"08.07.26";"Gebucht";"Me";"Shop";"Groceries";"Ausgang";"DE";"12,34";"";"";"ref-shop"',
			'"09.07.26";"09.07.26";"Gebucht";"Me";"Cafe";"Coffee";"Ausgang";"DE";"4,00";"";"";"ref-cafe"'
		]);

		const report = await confirmImport(db, {
			accountId: importAccount.accountId,
			adapterId: importAccount.bankId,
			csv,
			expectedHash: await sha256Hex(csv)
		});

		expect(report).toMatchObject({
			accountId: importAccount.accountId,
			adapterId: 'dkb_girocard',
			startDate: '2026-07-08',
			endDate: '2026-07-09',
			rowCount: 2,
			importedCount: 2,
			duplicateCount: 0,
			errorCount: 0,
			unknownCount: 1
		});
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM import_batches')).toBe(1);
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM transactions')).toBe(2);
		expect(
			firstValue<string>(
				sqlite,
				"SELECT category_id FROM transactions WHERE dedupe_key = 'dkb_ref:ref-shop|2026-07-08|2026-07-08|-1234'"
			)
		).toBe('cat-groceries');
		expect(
			firstValue<string>(
				sqlite,
				"SELECT classification_status FROM transactions WHERE dedupe_key = 'dkb_ref:ref-cafe|2026-07-09|2026-07-09|-400'"
			)
		).toBe('unknown');
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM transaction_review_flags')).toBe(1);
	});

	it('deduplicates existing rows and stores parse errors without raw CSV rows', async () => {
		const importAccount = await createDkbAccount();
		await insertTransaction(
			importAccount.accountId,
			'dkb_ref:ref-duplicate|2026-07-08|2026-07-08|-1234'
		);
		const csv = dkbCsv([
			'"08.07.26";"08.07.26";"Gebucht";"Me";"Duplicate";"Already imported";"Ausgang";"DE";"12,34";"";"";"ref-duplicate"',
			'"09.07.26";"09.07.26";"Gebucht";"Me";"Cafe";"Coffee";"Ausgang";"DE";"4,00";"";"";"ref-new"',
			'"10.07.26";"10.07.26";"Gebucht";"Me";"Bad";"Broken";"Ausgang";"DE";"not-money";"";"";"ref-bad"'
		]);

		const report = await confirmImport(db, {
			accountId: importAccount.accountId,
			adapterId: importAccount.bankId,
			csv,
			expectedHash: await sha256Hex(csv)
		});

		expect(report).toMatchObject({
			rowCount: 2,
			importedCount: 1,
			duplicateCount: 1,
			errorCount: 1,
			unknownCount: 1
		});
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM transactions')).toBe(2);
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM import_row_errors')).toBe(1);
		expect(
			firstValue<number>(
				sqlite,
				"SELECT COUNT(*) FROM pragma_table_info('import_row_errors') WHERE name LIKE '%raw%'"
			)
		).toBe(0);
		expect(
			firstValue<number>(
				sqlite,
				"SELECT duplicate_count FROM import_batches WHERE id = '" + report.batchId + "'"
			)
		).toBe(1);
	});

	it('rolls back the confirmed import when a later write fails', async () => {
		const importAccount = await createDkbAccount();
		const csv = dkbCsv([
			'"08.07.26";"08.07.26";"Gebucht";"Me";"Cafe";"Coffee";"Ausgang";"DE";"4,00";"";"";"ref-cafe"'
		]);
		const failingDb = createFailingBatchClient(db, 'INSERT INTO transaction_review_flags');

		await expect(
			confirmImport(failingDb, {
				accountId: importAccount.accountId,
				adapterId: importAccount.bankId,
				csv,
				expectedHash: await sha256Hex(csv)
			})
		).rejects.toThrow('forced batch failure');

		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM import_batches')).toBe(0);
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM transactions')).toBe(0);
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM transaction_review_flags')).toBe(0);
	});

	it('imports repeated N26 rows with identical visible fields', async () => {
		const importAccount = await createN26Account();
		const csv = n26Csv([
			'2026-07-08,2026-07-08,N26,,Fee,"ATM Withdrawal Fee",Main,-2.00,,,',
			'2026-07-08,2026-07-08,N26,,Fee,"ATM Withdrawal Fee",Main,-2.00,,,'
		]);

		const report = await confirmImport(db, {
			accountId: importAccount.accountId,
			adapterId: importAccount.bankId,
			csv,
			expectedHash: await sha256Hex(csv)
		});

		expect(report).toMatchObject({
			rowCount: 2,
			importedCount: 2,
			duplicateCount: 0,
			errorCount: 0
		});
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM transactions')).toBe(2);
		expect(firstValue<number>(sqlite, 'SELECT SUM(amount_cents) FROM transactions')).toBe(-400);
	});

	it('persists N26 Account Name as subaccount', async () => {
		const importAccount = await createN26Account();
		const csv = n26Csv([
			'2026-07-08,,Shop,DE,"Debit Transfer",Groceries,"Hauptkonto",-12.34,,,',
			'2026-07-09,,Employer,DE,"Credit Transfer",Salary,"20k in 2023",2500.00,,,'
		]);

		await confirmImport(db, {
			accountId: importAccount.accountId,
			adapterId: importAccount.bankId,
			csv,
			expectedHash: await sha256Hex(csv)
		});

		const row = await db
			.prepare(
				'SELECT GROUP_CONCAT(DISTINCT subaccount) AS subaccounts FROM transactions WHERE account_id = ?'
			)
			.bind(importAccount.accountId)
			.first<{ subaccounts: string }>();
		expect(row?.subaccounts?.split(',').sort()).toEqual(['20k in 2023', 'Hauptkonto']);
	});

	it('imports the latest N26 fixture to the expected computed balance', async () => {
		const importAccount = await createN26Account();
		const csv = await readFile(resolve('tests/fixtures/n26-basic.csv'), 'utf8');

		const report = await confirmImport(db, {
			accountId: importAccount.accountId,
			adapterId: importAccount.bankId,
			csv,
			expectedHash: await sha256Hex(csv)
		});

		expect(report).toMatchObject({
			rowCount: 4,
			importedCount: 4,
			duplicateCount: 0,
			errorCount: 0,
			unknownCount: 4
		});
		expect(firstValue<number>(sqlite, 'SELECT SUM(amount_cents) FROM transactions')).toBe(243350);
	});

	it('rejects hash mismatches, missing profiles, and repeated file imports', async () => {
		const importAccount = await createDkbAccount();
		const csv = dkbCsv([
			'"08.07.26";"08.07.26";"Gebucht";"Me";"Shop";"Groceries";"Ausgang";"DE";"12,34";"";"";"ref-shop"'
		]);
		const expectedHash = await sha256Hex(csv);

		await expect(
			confirmImport(db, {
				accountId: importAccount.accountId,
				adapterId: importAccount.bankId,
				csv,
				expectedHash: 'bad'
			})
		).rejects.toThrow('File hash does not match preview');
		await expect(
			confirmImport(db, { accountId: 'missing', adapterId: 'dkb_girocard', csv, expectedHash })
		).rejects.toThrow('Account not found');

		await confirmImport(db, {
			accountId: importAccount.accountId,
			adapterId: importAccount.bankId,
			csv,
			expectedHash
		});
		await expect(
			confirmImport(db, {
				accountId: importAccount.accountId,
				adapterId: importAccount.bankId,
				csv,
				expectedHash
			})
		).rejects.toThrow('Import batch already exists for this account and file');
	});

	it('creates conservative recurring suggestions after confirmed imports', async () => {
		const importAccount = await createDkbAccount();
		await createCategoryRule(db, {
			categoryId: 'cat-utilities',
			name: 'Power Co payee',
			field: 'payee',
			operator: 'contains',
			pattern: 'Power Co',
			priority: 10
		});
		const csv = dkbCsv([
			'"14.04.26";"14.04.26";"Gebucht";"Me";"Power Co";"Electricity";"Ausgang";"DE";"46,00";"";"";"ref-power-apr"',
			'"15.05.26";"15.05.26";"Gebucht";"Me";"Power Co";"Electricity";"Ausgang";"DE";"46,00";"";"";"ref-power-may"',
			'"14.06.26";"14.06.26";"Gebucht";"Me";"Power Co";"Electricity";"Ausgang";"DE";"46,00";"";"";"ref-power-jun"'
		]);

		await confirmImport(db, {
			accountId: importAccount.accountId,
			adapterId: importAccount.bankId,
			csv,
			expectedHash: await sha256Hex(csv)
		});

		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM recurring_groups')).toBe(1);
		expect(
			firstValue<string>(
				sqlite,
				"SELECT status || ':' || cadence || ':' || next_date FROM recurring_groups"
			)
		).toBe('suggested:monthly:2026-07-14');
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM recurring_group_transactions')).toBe(3);
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

async function insertTransaction(accountId: string, dedupeKey: string) {
	await db
		.prepare(
			`INSERT INTO transactions (
				id, account_id, dedupe_key, booking_date, amount_cents, search_text
			) VALUES (?, ?, ?, ?, ?, ?)`
		)
		.bind(crypto.randomUUID(), accountId, dedupeKey, '2026-07-08', -1234, 'duplicate')
		.run();
}

function dkbCsv(rows: string[]): string {
	return [
		'"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"',
		...rows
	].join('\n');
}

function n26Csv(rows: string[]): string {
	return [
		'"Booking Date","Value Date","Partner Name","Partner Iban",Type,"Payment Reference","Account Name","Amount (EUR)","Original Amount","Original Currency","Exchange Rate"',
		...rows
	].join('\n');
}

function createFailingBatchClient(db: DbClient, failingSql: string): DbClient {
	return {
		prepare(sql) {
			const statement = db.prepare(sql);
			return sql.includes(failingSql) ? new FailingStatement(statement) : statement;
		},
		batch(statements) {
			if (!db.batch) {
				throw new Error('Test database does not support batch');
			}

			return db.batch(statements);
		}
	};
}

class FailingStatement implements DbStatement {
	constructor(private readonly statement: DbStatement) {}

	bind(...values: DbValue[]): DbStatement {
		this.statement.bind(...values);
		return this;
	}

	all<T extends Record<string, DbValue>>() {
		return this.statement.all<T>();
	}

	first<T extends Record<string, DbValue>>() {
		return this.statement.first<T>();
	}

	async run(): Promise<DbRunResult> {
		throw new Error('forced batch failure');
	}
}
