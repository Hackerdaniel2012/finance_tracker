import { beforeEach, describe, expect, it } from 'vitest';
import {
	applyMigrations,
	createTestDatabase,
	createTestDbClient
} from '../../../../tests/db/test-database';
import { createAccount } from '../accounts/repository';
import type { DbClient } from '../db-client';
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
});

export function n26Csv(): string {
	return [
		'"Booking Date","Value Date","Partner Name","Partner Iban","Type","Payment Reference","Account Name","Amount (EUR)","Original Amount","Original Currency","Exchange Rate"',
		'2026-07-01,2026-07-01,Employer,,Credit Transfer,Salary,Main,1000.00,,,',
		'2026-07-02,2026-07-02,Shop,,Debit Transfer,Food,Main,-20.00,,,',
		'2026-07-03,2026-07-03,Transfer,,Credit Transfer,Savings,Savings,100.00,,,'
	].join('\n');
}
