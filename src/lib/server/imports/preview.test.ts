import { beforeEach, describe, expect, it } from 'vitest';
import {
	applyMigrations,
	createTestDatabase,
	createTestDbClient
} from '../../../../tests/db/test-database';
import { createAccount } from '../accounts/repository';
import type { DbClient } from '../db-client';
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
		expect(preview.readyToConfirm).toBe(false);
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
		const discovered = await previewImport(db, { adapterId: 'n26', csv });
		expect(discovered.accounts[0].importableRows).toEqual([]);

		const checked = await previewImport(db, {
			adapterId: 'n26',
			csv,
			assignments: [
				{
					sourceAccountKey: 'Main',
					targetAccountId: account.id,
					balanceMode: 'anchored'
				}
			]
		});

		expect(checked.accounts[0].importableRowCount).toBe(1);
		expect(checked.accounts[0].duplicateRows).toHaveLength(1);
		expect(checked.accounts[0].importableRows).toMatchObject([{ payee: 'Shop' }]);
	});
});

export function n26Csv(): string {
	return [
		'"Booking Date","Value Date","Partner Name","Partner Iban","Type","Payment Reference","Account Name","Amount (EUR)","Original Amount","Original Currency","Exchange Rate"',
		'2026-07-01,2026-07-01,Employer,,Credit Transfer,Salary,Main,1000.00,,,',
		'2026-07-02,2026-07-02,Shop,,Debit Transfer,Food,Main,-20.00,,,',
		'2026-07-03,2026-07-03,Transfer,,Credit Transfer,Savings,Savings,100.00,,,'
	].join('\n');
}
