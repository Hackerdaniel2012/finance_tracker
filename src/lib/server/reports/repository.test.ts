import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	applySql,
	createTestDatabase,
	createTestDbClient
} from '../../../../tests/db/test-database';
import { createAccount, createProfile } from '../accounts/repository';
import { createCategoryRule } from '../categories/repository';
import type { DbClient } from '../db-client';
import { confirmImport } from '../imports/confirm';
import { sha256Hex } from '../imports/shared';
import { getNetWorthReport, getSummaryReport } from './repository';

let db: DbClient;

beforeEach(async () => {
	const sqlite = await createTestDatabase();
	applySql(sqlite, await readFile(resolve('migrations/0001_initial_schema.sql'), 'utf8'));
	applySql(sqlite, await readFile(resolve('migrations/0002_seed_default_categories.sql'), 'utf8'));
	db = createTestDbClient(sqlite);
});

describe('reports repository', () => {
	it('builds a summary report from imported transactions', async () => {
		await seedReportData();

		const summary = await getSummaryReport(db, { from: '2026-07-01', to: '2026-07-31' });

		expect(summary.totals).toEqual({
			incomeCents: 250000,
			expenseCents: -1634,
			netCents: 248366,
			transactionCount: 3,
			unknownCount: 1
		});
		expect(summary.byCategory).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					categoryId: 'cat-salary',
					categoryName: 'Salary',
					amountCents: 250000,
					transactionCount: 1
				}),
				expect.objectContaining({
					categoryId: 'cat-groceries',
					categoryName: 'Groceries',
					amountCents: -1234,
					transactionCount: 1
				}),
				expect.objectContaining({
					categoryId: null,
					categoryName: 'Unknown',
					amountCents: -400,
					transactionCount: 1
				})
			])
		);
		expect(summary.byAccount[0]).toMatchObject({
			accountName: 'DKB Giro',
			balanceCents: 258366,
			incomeCents: 250000,
			expenseCents: -1634,
			netCents: 248366
		});
		expect(summary.recentTransactions).toHaveLength(3);
	});

	it('builds net worth points from snapshots, balances, and liabilities', async () => {
		const account = await seedReportData();
		await db
			.prepare(
				`INSERT INTO account_balance_snapshots (id, account_id, snapshot_date, balance_cents, source)
				VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)`
			)
			.bind(
				'snapshot-1',
				account.id,
				'2026-07-01',
				100000,
				'manual',
				'snapshot-2',
				account.id,
				'2026-07-15',
				200000,
				'manual'
			)
			.run();
		await db
			.prepare(
				`INSERT INTO marked_liabilities (id, account_id, name, amount_cents, as_of_date)
				VALUES (?, ?, ?, ?, ?)`
			)
			.bind('liability-1', account.id, 'Credit card', 50000, '2026-07-10')
			.run();

		const netWorth = await getNetWorthReport(db, { from: '2026-07-01', to: '2026-07-31' });

		expect(netWorth.accounts).toEqual([
			expect.objectContaining({ accountName: 'DKB Giro', balanceCents: 258366 })
		]);
		expect(netWorth.liabilities).toEqual([
			{ id: 'liability-1', name: 'Credit card', amountCents: 50000, asOfDate: '2026-07-10' }
		]);
		expect(netWorth.points).toEqual([
			{ date: '2026-07-01', assetsCents: 100000, liabilitiesCents: 0, netWorthCents: 100000 },
			{ date: '2026-07-08', assetsCents: 98766, liabilitiesCents: 0, netWorthCents: 98766 },
			{ date: '2026-07-09', assetsCents: 98366, liabilitiesCents: 0, netWorthCents: 98366 },
			{
				date: '2026-07-10',
				assetsCents: 98366,
				liabilitiesCents: 50000,
				netWorthCents: 48366
			},
			{
				date: '2026-07-15',
				assetsCents: 200000,
				liabilitiesCents: 50000,
				netWorthCents: 150000
			},
			{
				date: '2026-07-25',
				assetsCents: 450000,
				liabilitiesCents: 50000,
				netWorthCents: 400000
			},
			{
				date: '2026-07-31',
				assetsCents: 450000,
				liabilitiesCents: 50000,
				netWorthCents: 400000
			}
		]);
	});

	it('falls back to balance-after transactions and transaction deltas for net worth points', async () => {
		const account = await createAccount(db, { name: 'N26 Main', openingBalanceCents: 100000 });
		const profile = await createProfile(db, {
			accountId: account.id,
			bankId: 'n26',
			label: 'N26 CSV'
		});
		await db
			.prepare(
				`INSERT INTO transactions (
					id, profile_id, account_id, dedupe_key, booking_date, amount_cents, currency,
					balance_after_cents, search_text, classification_status
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(
				'tx-balance-after',
				profile.id,
				account.id,
				'key-balance-after',
				'2026-07-05',
				-2000,
				'EUR',
				98000,
				'grocery',
				'unknown',
				'tx-without-balance',
				profile.id,
				account.id,
				'key-without-balance',
				'2026-07-07',
				-3000,
				'EUR',
				null,
				'pharmacy',
				'unknown',
				'tx-income',
				profile.id,
				account.id,
				'key-income',
				'2026-07-20',
				10000,
				'EUR',
				null,
				'income',
				'unknown'
			)
			.run();

		const netWorth = await getNetWorthReport(db, { from: '2026-07-01', to: '2026-07-31' });

		expect(netWorth.points).toEqual([
			{ date: '2026-07-01', assetsCents: 100000, liabilitiesCents: 0, netWorthCents: 100000 },
			{ date: '2026-07-05', assetsCents: 98000, liabilitiesCents: 0, netWorthCents: 98000 },
			{ date: '2026-07-07', assetsCents: 95000, liabilitiesCents: 0, netWorthCents: 95000 },
			{ date: '2026-07-20', assetsCents: 105000, liabilitiesCents: 0, netWorthCents: 105000 },
			{ date: '2026-07-31', assetsCents: 105000, liabilitiesCents: 0, netWorthCents: 105000 }
		]);
	});
});

async function seedReportData() {
	const account = await createAccount(db, { name: 'DKB Giro', openingBalanceCents: 10000 });
	const profile = await createProfile(db, {
		accountId: account.id,
		bankId: 'dkb',
		label: 'DKB CSV'
	});
	await createCategoryRule(db, {
		categoryId: 'cat-groceries',
		name: 'Shop rule',
		field: 'payee',
		operator: 'contains',
		pattern: 'Shop',
		priority: 10
	});
	await createCategoryRule(db, {
		categoryId: 'cat-salary',
		name: 'Employer rule',
		field: 'payee',
		operator: 'contains',
		pattern: 'Employer',
		priority: 10
	});
	const csv = dkbCsv([
		'"08.07.26";"08.07.26";"Gebucht";"Me";"Shop";"Groceries";"Ausgang";"DE";"12,34";"";"";"ref-shop"',
		'"09.07.26";"09.07.26";"Gebucht";"Me";"Cafe";"Coffee";"Ausgang";"DE";"4,00";"";"";"ref-cafe"',
		'"25.07.26";"25.07.26";"Gebucht";"Employer";"Me";"Salary";"Eingang";"DE";"2500,00";"";"";"ref-salary"'
	]);

	await confirmImport(db, {
		profileId: profile.id,
		csv,
		expectedHash: await sha256Hex(csv)
	});

	return account;
}

function dkbCsv(rows: string[]): string {
	return [
		'"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"',
		...rows
	].join('\n');
}
