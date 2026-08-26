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
import { importIntoExistingAccount } from './test-support';

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

	it('requires an existing balance anchor for anchored calculation', async () => {
		const account = await createAccount(db, { name: 'Uninitialized account' });
		const csv = n26Csv().split('\n').slice(0, 2).join('\n');
		const discovered = await previewImport(db, { adapterId: 'n26', csv });

		await expect(
			previewImport(db, {
				adapterId: 'n26',
				csv,
				assignments: [
					{
						sourceAccountKey: discovered.accounts[0].sourceAccountKey,
						targetAccountId: account.id,
						balanceMode: 'anchored'
					}
				]
			})
		).rejects.toThrow('requires an initialized account');
	});

	it('still requires a reported balance when no anchor exists', async () => {
		const account = await createAccount(db, { name: 'Uninitialized account' });
		const csv = n26Csv().split('\n').slice(0, 2).join('\n');
		const discovered = await previewImport(db, { adapterId: 'n26', csv });

		await expect(
			previewImport(db, {
				adapterId: 'n26',
				csv,
				assignments: [
					{
						sourceAccountKey: discovered.accounts[0].sourceAccountKey,
						targetAccountId: account.id,
						balanceMode: 'reported'
					}
				]
			})
		).rejects.toThrow('reportedBalanceCents is required');
	});

	it('returns only rows that would actually be imported after duplicate checking', async () => {
		const account = await createAccount(db, { name: 'Existing account' });
		const [header, existingRow, newRow] = n26Csv().split('\n');
		await importIntoExistingAccount(db, {
			accountId: account.id,
			adapterId: 'n26',
			csv: [header, existingRow].join('\n'),
			reportedBalanceCents: 100_000
		});
		const csv = [header, existingRow, newRow].join('\n');
		const checked = await previewImport(db, { adapterId: 'n26', csv });

		expect(checked.status).toBe('ready');
		expect(checked.accounts[0].assignment?.balanceMode).toBe('anchored');
		expect(checked.accounts[0].importableRowCount).toBe(1);
		expect(checked.accounts[0].duplicateRows).toHaveLength(1);
		expect(checked.accounts[0].importableRows).toMatchObject([{ payee: 'Shop' }]);
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
			'anchored',
			'anchored'
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
		expect(preview.accounts[0]?.assignment?.balanceMode).toBe('anchored');
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

	it('requires an initialized account for anchored calculation', async () => {
		const account = await createAccount(db, { name: 'Empty account' });
		await expect(
			previewImport(db, {
				adapterId: 'n26',
				csv: n26Csv().split('\n').slice(0, 2).join('\n'),
				assignments: [
					{
						sourceAccountKey: 'Main',
						targetAccountId: account.id,
						balanceMode: 'anchored'
					}
				]
			})
		).rejects.toThrow('requires an initialized account');
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
