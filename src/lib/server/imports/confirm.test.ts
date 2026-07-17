import { beforeEach, describe, expect, it } from 'vitest';
import {
	applyMigrations,
	createTestDatabase,
	createTestDbClient,
	firstValue
} from '../../../../tests/db/test-database';
import type { DbClient } from '../db-client';
import { listCalculatedAccountBalances } from '../accounts/balance';
import { createAccount } from '../accounts/repository';
import { createPlan } from '../plans/repository';
import { confirmImport } from './confirm';
import { previewImport } from './preview';
import { n26Csv } from './preview.test';

let db: DbClient;
let sqlite: Awaited<ReturnType<typeof createTestDatabase>>;

beforeEach(async () => {
	sqlite = await createTestDatabase();
	await applyMigrations(sqlite);
	db = createTestDbClient(sqlite);
});

describe('confirmImport', () => {
	it('atomically creates accounts, mappings, batches and grouped transactions', async () => {
		const csv = n26Csv();
		const discovery = await previewImport(db, { adapterId: 'n26', csv });
		const assignments = [
			{
				sourceAccountKey: 'Main',
				newAccount: { name: 'N26 Main', institution: 'N26' },
				balanceMode: 'complete_history' as const
			},
			{
				sourceAccountKey: 'Savings',
				newAccount: { name: 'N26 Savings', institution: 'N26' },
				balanceMode: 'reported' as const,
				reportedBalanceCents: 10000
			}
		];
		const checked = await previewImport(db, { adapterId: 'n26', csv, assignments });
		expect(checked.readyToConfirm).toBe(true);
		expect(checked.accounts[0].calculatedBalanceCents).toBe(98000);

		const report = await confirmImport(db, {
			adapterId: 'n26',
			csv,
			expectedHash: discovery.fileHash,
			expectedConfigurationHash: checked.configurationHash!,
			assignments
		});
		expect(report.accounts).toHaveLength(2);
		expect(report.importedCount).toBe(3);
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM import_runs')).toBe(1);
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM import_batches')).toBe(2);
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM accounts')).toBe(2);
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM import_account_mappings')).toBe(2);
		expect(firstValue<number>(sqlite, 'SELECT COUNT(DISTINCT account_id) FROM transactions')).toBe(
			2
		);
	});

	it('rejects a changed file and a repeated run', async () => {
		const csv = n26Csv();
		const preview = await previewImport(db, { adapterId: 'n26', csv });
		const assignments = preview.accounts.map((group) => ({
			sourceAccountKey: group.sourceAccountKey,
			newAccount: { name: group.sourceAccountLabel, institution: 'N26' },
			balanceMode: 'complete_history' as const
		}));
		const checked = await previewImport(db, { adapterId: 'n26', csv, assignments });
		await expect(
			confirmImport(db, {
				adapterId: 'n26',
				csv: `${csv}\n`,
				expectedHash: preview.fileHash,
				expectedConfigurationHash: checked.configurationHash!,
				assignments
			})
		).rejects.toThrow('File hash');
		await confirmImport(db, {
			adapterId: 'n26',
			csv,
			expectedHash: preview.fileHash,
			expectedConfigurationHash: checked.configurationHash!,
			assignments
		});
		await expect(
			confirmImport(db, {
				adapterId: 'n26',
				csv,
				expectedHash: preview.fileHash,
				expectedConfigurationHash: checked.configurationHash!,
				assignments
			})
		).rejects.toThrow('already exists');
	});

	it('maps a concurrent duplicate file insertion to a conflict without partial writes', async () => {
		const csv = n26Csv().split('\n').slice(0, 2).join('\n');
		const discovery = await previewImport(db, { adapterId: 'n26', csv });
		const assignments = [
			{
				sourceAccountKey: discovery.accounts[0]!.sourceAccountKey,
				newAccount: { name: 'Concurrent account', institution: 'N26' },
				balanceMode: 'complete_history' as const
			}
		];
		const checked = await previewImport(db, { adapterId: 'n26', csv, assignments });
		let insertedCompetingRun = false;
		const racingDb: DbClient = {
			prepare(statement) {
				return db.prepare(statement);
			},
			async batch(statements) {
				if (!insertedCompetingRun) {
					insertedCompetingRun = true;
					await db
						.prepare(
							`INSERT INTO import_runs (id, file_hash, adapter_id)
							VALUES ('competing-run', ?, 'n26')`
						)
						.bind(discovery.fileHash)
						.run();
					await db
						.prepare(
							`INSERT INTO import_file_claims (adapter_id, file_hash, import_run_id)
							VALUES ('n26', ?, 'competing-run')`
						)
						.bind(discovery.fileHash)
						.run();
				}
				return db.batch!(statements);
			}
		};

		await expect(
			confirmImport(racingDb, {
				adapterId: 'n26',
				csv,
				expectedHash: discovery.fileHash,
				expectedConfigurationHash: checked.configurationHash!,
				assignments
			})
		).rejects.toThrow('Import run already exists for this file');
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM import_runs')).toBe(1);
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM import_file_claims')).toBe(1);
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM accounts')).toBe(0);
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM import_batches')).toBe(0);
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM transactions')).toBe(0);
	});

	it('rolls back the common run when a child batch conflicts', async () => {
		const csv = n26Csv().split('\n').slice(0, 3).join('\n');
		const preview = await previewImport(db, { adapterId: 'n26', csv });
		const accountId = 'existing';
		await db
			.prepare("INSERT INTO accounts (id, name) VALUES (?, 'Existing')")
			.bind(accountId)
			.run();
		await db
			.prepare(
				"INSERT INTO import_batches (id, account_id, file_hash, adapter_id) VALUES ('legacy', ?, ?, 'n26')"
			)
			.bind(accountId, preview.fileHash)
			.run();
		const assignments = [
			{
				sourceAccountKey: 'Main',
				targetAccountId: accountId,
				balanceMode: 'reported' as const,
				reportedBalanceCents: 0
			}
		];
		const checked = await previewImport(db, { adapterId: 'n26', csv, assignments });
		await expect(
			confirmImport(db, {
				adapterId: 'n26',
				csv,
				expectedHash: preview.fileHash,
				expectedConfigurationHash: checked.configurationHash!,
				assignments
			})
		).rejects.toThrow();
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM import_runs')).toBe(0);
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM import_account_mappings')).toBe(0);
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM transactions')).toBe(0);
	});

	it('anchors complete history at the CSV end without including future transactions', async () => {
		const account = await createAccount(db, { name: 'Existing account' });
		await db
			.prepare(
				`INSERT INTO import_runs (id, file_hash, adapter_id)
				VALUES ('older-run', 'older-file', 'n26')`
			)
			.run();
		await db
			.prepare(
				`INSERT INTO import_batches (
					id, account_id, file_hash, adapter_id, import_run_id, start_date, end_date
				) VALUES ('older-batch', ?, 'older-file', 'n26', 'older-run', '2026-07-01', '2026-07-05')`
			)
			.bind(account.id)
			.run();
		await db
			.prepare(
				`INSERT INTO transactions (
					id, account_id, import_batch_id, dedupe_key, booking_date, amount_cents, search_text
				) VALUES
					('past', ?, 'older-batch', 'past', '2026-07-01', 1000, 'past'),
					('same-day', ?, 'older-batch', 'same-day', '2026-07-05', 300, 'same-day'),
					('future', ?, NULL, 'future', '2026-07-10', 500, 'future')`
			)
			.bind(account.id, account.id, account.id)
			.run();
		const csv = [
			'"Booking Date","Value Date","Partner Name","Partner Iban","Type","Payment Reference","Account Name","Amount (EUR)","Original Amount","Original Currency","Exchange Rate"',
			'2026-07-05,2026-07-05,Shop,,Debit Transfer,Food,Main,-2.00,,,'
		].join('\n');
		const discovery = await previewImport(db, { adapterId: 'n26', csv });
		const assignments = [
			{
				sourceAccountKey: discovery.accounts[0]!.sourceAccountKey,
				targetAccountId: account.id,
				balanceMode: 'complete_history' as const
			}
		];
		const checked = await previewImport(db, { adapterId: 'n26', csv, assignments });
		expect(checked.accounts[0]!.calculatedBalanceCents).toBe(1100);

		await confirmImport(db, {
			adapterId: 'n26',
			csv,
			expectedHash: discovery.fileHash,
			expectedConfigurationHash: checked.configurationHash!,
			assignments
		});
		expect(
			(await listCalculatedAccountBalances(db, '2026-07-05', account.id))[0]?.balanceCents
		).toBe(1100);
		expect(
			(await listCalculatedAccountBalances(db, '2026-07-20', account.id))[0]?.balanceCents
		).toBe(1600);
	});

	it('reports unknown counts from the final state after plan matching', async () => {
		const account = await createAccount(db, { name: 'Plan account' });
		await createPlan(db, {
			accountId: account.id,
			categoryId: 'cat-shopping',
			counterparty: 'Plan Merchant',
			direction: 'expense',
			cadence: 'once',
			amountCents: 1234,
			nextDate: '2026-07-05'
		});
		const csv = [
			'"Booking Date","Value Date","Partner Name","Partner Iban","Type","Payment Reference","Account Name","Amount (EUR)","Original Amount","Original Currency","Exchange Rate"',
			'2026-07-05,2026-07-05,Plan Merchant,,Debit Transfer,Planned purchase,Main,-12.34,,,',
			'2026-07-05,2026-07-05,Other Merchant,,Debit Transfer,Unplanned purchase,Main,-5.00,,,'
		].join('\n');
		const discovery = await previewImport(db, { adapterId: 'n26', csv });
		const assignments = [
			{
				sourceAccountKey: 'Main',
				targetAccountId: account.id,
				balanceMode: 'complete_history' as const
			}
		];
		const checked = await previewImport(db, { adapterId: 'n26', csv, assignments });

		const report = await confirmImport(db, {
			adapterId: 'n26',
			csv,
			expectedHash: discovery.fileHash,
			expectedConfigurationHash: checked.configurationHash!,
			assignments
		});

		expect(report.unknownCount).toBe(1);
		expect(report.accounts[0]?.unknownCount).toBe(1);
		expect(
			sqlite.exec(
				`SELECT payee, classification_status
				FROM transactions
				ORDER BY amount_cents`
			)[0]?.values
		).toEqual([
			['Plan Merchant', 'auto'],
			['Other Merchant', 'unknown']
		]);
	});
});
