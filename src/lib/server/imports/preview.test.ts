import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	applyMigrations,
	createTestDatabase,
	createTestDbClient
} from '../../../../tests/db/test-database';
import { createAccount } from '../accounts/repository';
import type { DbClient } from '../db-client';
import { confirmImport } from './confirm';
import { previewImport } from './preview';

let db: DbClient;

beforeEach(async () => {
	const sqlite = await createTestDatabase();
	await applyMigrations(sqlite);
	db = createTestDbClient(sqlite);
});

describe('previewImport', () => {
	it('discovers and groups multiple N26 accounts without writing data', async () => {
		const preview = await previewImport(db, { adapterId: 'n26', csv: n26Csv() });
		expect(preview.status).toBe('needs_configuration');
		expect(preview.summary).toMatchObject({ parsedRows: 3, accountCount: 2 });
		expect(preview.accounts.map((group) => [group.sourceAccountKey, group.rowCount])).toEqual([
			['Main', 2],
			['Savings', 1]
		]);
	});

	it('suggests a remembered stable mapping and validates distinct targets', async () => {
		const main = await createAccount(db, { name: 'My N26' });
		await db
			.prepare(
				"INSERT INTO import_account_mappings (adapter_id, source_account_key, account_id) VALUES ('n26', 'Main', ?)"
			)
			.bind(main.id)
			.run();
		const discovered = await previewImport(db, { adapterId: 'n26', csv: n26Csv() });
		expect(discovered.accounts[0].suggestedAccountId).toBe(main.id);

		await expect(
			previewImport(db, {
				adapterId: 'n26',
				csv: n26Csv(),
				assignments: discovered.accounts.map((group) => ({
					sourceAccountKey: group.sourceAccountKey,
					targetAccountId: main.id,
					balanceMode: 'reported' as const,
					reportedBalanceCents: 0
				}))
			})
		).rejects.toThrow('different target account');
	});

	it('auto-resolves initialized mappings and counts overlapping update rows', async () => {
		const csv = n26Csv();
		const assignments = [
			{
				sourceAccountKey: 'Main',
				newAccount: { name: 'N26 Main', institution: 'N26' },
				balanceMode: 'complete_history' as const
			},
			{
				sourceAccountKey: 'Savings',
				newAccount: { name: 'N26 Savings', institution: 'N26' },
				balanceMode: 'complete_history' as const
			}
		];
		const initial = await previewImport(db, { adapterId: 'n26', csv, assignments });
		await confirmImport(db, {
			adapterId: 'n26',
			csv,
			expectedHash: initial.fileHash,
			expectedConfigurationHash: initial.configurationHash!,
			assignments
		});

		const update = await previewImport(db, { adapterId: 'n26', csv: n26UpdateCsv() });

		expect(update.status).toBe('ready');
		expect(update.summary).toMatchObject({ newRowCount: 2, duplicateCount: 2 });
		expect(update.accounts.map((group) => group.assignment?.balanceMode)).toEqual([
			'continue_from_snapshot',
			'continue_from_snapshot'
		]);
		expect(update.accounts.map((group) => group.importableRowCount)).toEqual([1, 1]);
		expect(update.accounts.map((group) => group.duplicateRows.length)).toEqual([1, 1]);
		expect(update.accounts.map((group) => group.calculatedBalanceCents)).toEqual([97500, 10500]);
	});

	it('keeps totals unresolved when an update contains a new source account', async () => {
		const csv = n26Csv().split('\n').slice(0, 3).join('\n');
		const assignments = [
			{
				sourceAccountKey: 'Main',
				newAccount: { name: 'N26 Main', institution: 'N26' },
				balanceMode: 'complete_history' as const
			}
		];
		const initial = await previewImport(db, { adapterId: 'n26', csv, assignments });
		await confirmImport(db, {
			adapterId: 'n26',
			csv,
			expectedHash: initial.fileHash,
			expectedConfigurationHash: initial.configurationHash!,
			assignments
		});
		const mixedCsv = [
			n26Header,
			'2026-07-02,2026-07-02,Shop,,Debit Transfer,Food,Main,-20.00,,,',
			'2026-07-04,2026-07-04,Transfer,,Credit Transfer,Reserve,Reserve,50.00,,,'
		].join('\n');

		const preview = await previewImport(db, { adapterId: 'n26', csv: mixedCsv });

		expect(preview.status).toBe('needs_configuration');
		expect(preview.summary).toMatchObject({ newRowCount: null, duplicateCount: null });
		expect(preview.accounts[0]).toMatchObject({ importableRowCount: 0 });
		expect(preview.accounts[0]?.assignment?.balanceMode).toBe('continue_from_snapshot');
		expect(preview.accounts[1]).toMatchObject({ importableRowCount: null, assignment: null });
	});

	it('reports a duplicate-only mapped file without creating another run', async () => {
		const csv = n26Csv().split('\n').slice(0, 3).join('\n');
		const assignments = [
			{
				sourceAccountKey: 'Main',
				newAccount: { name: 'N26 Main', institution: 'N26' },
				balanceMode: 'complete_history' as const
			}
		];
		const initial = await previewImport(db, { adapterId: 'n26', csv, assignments });
		await confirmImport(db, {
			adapterId: 'n26',
			csv,
			expectedHash: initial.fileHash,
			expectedConfigurationHash: initial.configurationHash!,
			assignments
		});

		const repeated = await previewImport(db, { adapterId: 'n26', csv });

		expect(repeated.status).toBe('no_new_transactions');
		expect(repeated.summary).toMatchObject({ newRowCount: 0, duplicateCount: 2 });
	});

	it('requires an initialized account for snapshot continuation', async () => {
		const account = await createAccount(db, { name: 'Empty account' });
		await expect(
			previewImport(db, {
				adapterId: 'n26',
				csv: n26Csv().split('\n').slice(0, 2).join('\n'),
				assignments: [
					{
						sourceAccountKey: 'Main',
						targetAccountId: account.id,
						balanceMode: 'continue_from_snapshot'
					}
				]
			})
		).rejects.toThrow('initialized existing account');
	});

	it('does not remember a target for a keyless adapter', async () => {
		const csv = await readFile(resolve('tests/fixtures/trade-republic-basic.csv'), 'utf8');
		const assignments = [
			{
				sourceAccountKey: null,
				newAccount: { name: 'Brokerage', institution: 'Trade Republic' },
				balanceMode: 'complete_history' as const
			}
		];
		const initial = await previewImport(db, {
			adapterId: 'trade_republic',
			csv,
			assignments
		});
		await confirmImport(db, {
			adapterId: 'trade_republic',
			csv,
			expectedHash: initial.fileHash,
			expectedConfigurationHash: initial.configurationHash!,
			assignments
		});

		const repeated = await previewImport(db, { adapterId: 'trade_republic', csv });

		expect(repeated.status).toBe('needs_configuration');
		expect(repeated.accounts[0]).toMatchObject({
			sourceAccountKey: null,
			suggestedAccountId: null,
			assignment: null,
			importableRowCount: null
		});
	});
});

const n26Header =
	'"Booking Date","Value Date","Partner Name","Partner Iban","Type","Payment Reference","Account Name","Amount (EUR)","Original Amount","Original Currency","Exchange Rate"';

export function n26Csv(): string {
	return [
		n26Header,
		'2026-07-01,2026-07-01,Employer,,Credit Transfer,Salary,Main,1000.00,,,',
		'2026-07-02,2026-07-02,Shop,,Debit Transfer,Food,Main,-20.00,,,',
		'2026-07-03,2026-07-03,Transfer,,Credit Transfer,Savings,Savings,100.00,,,'
	].join('\n');
}

export function n26UpdateCsv(): string {
	return [
		n26Header,
		'2026-07-02,2026-07-02,Shop,,Debit Transfer,Food,Main,-20.00,,,',
		'2026-07-04,2026-07-04,Cafe,,Debit Transfer,Coffee,Main,-5.00,,,',
		'2026-07-03,2026-07-03,Transfer,,Credit Transfer,Savings,Savings,100.00,,,',
		'2026-07-04,2026-07-04,Interest,,Credit Transfer,Interest,Savings,5.00,,,'
	].join('\n');
}
