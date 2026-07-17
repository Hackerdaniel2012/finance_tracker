import { beforeEach, describe, expect, it } from 'vitest';
import {
	applyMigrations,
	createTestDatabase,
	createTestDbClient,
	firstValue
} from '../../../../tests/db/test-database';
import type { DbClient } from '../db-client';
import { confirmImport } from './confirm';
import { previewImport } from './preview';
import { n26Csv } from './preview.test';
import { deleteImportRun, listImportRuns } from './repository';

let db: DbClient;
let sqlite: Awaited<ReturnType<typeof createTestDatabase>>;
beforeEach(async () => {
	sqlite = await createTestDatabase();
	await applyMigrations(sqlite);
	db = createTestDbClient(sqlite);
});

describe('import run repository', () => {
	it('lists one run for all accounts and rolls it back without deleting created accounts', async () => {
		const csv = n26Csv();
		const preview = await previewImport(db, { adapterId: 'n26', csv });
		const assignments = preview.accounts.map((group) => ({
			sourceAccountKey: group.sourceAccountKey,
			newAccount: { name: group.sourceAccountLabel, institution: 'N26' },
			balanceMode: 'complete_history' as const
		}));
		const checked = await previewImport(db, { adapterId: 'n26', csv, assignments });
		const report = await confirmImport(db, {
			adapterId: 'n26',
			csv,
			expectedHash: preview.fileHash,
			expectedConfigurationHash: checked.configurationHash!,
			assignments
		});
		const runs = await listImportRuns(db);
		expect(runs).toHaveLength(1);
		expect(runs[0].accounts).toHaveLength(2);
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM import_file_claims')).toBe(1);
		await deleteImportRun(db, report.runId);
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM transactions')).toBe(0);
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM import_runs')).toBe(0);
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM import_file_claims')).toBe(0);
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM accounts')).toBe(2);

		const repeatedPreview = await previewImport(db, { adapterId: 'n26', csv, assignments });
		await confirmImport(db, {
			adapterId: 'n26',
			csv,
			expectedHash: repeatedPreview.fileHash,
			expectedConfigurationHash: repeatedPreview.configurationHash!,
			assignments
		});
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM import_runs')).toBe(1);
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM import_file_claims')).toBe(1);
	});

	it('uses run order instead of rebuilt child batch rowids for deletion chronology', async () => {
		await db.prepare("INSERT INTO accounts (id, name) VALUES ('account', 'Account')").run();
		await db
			.prepare(
				`INSERT INTO import_runs (
					id, file_hash, adapter_id, created_at, import_order
				) VALUES
					('newer', 'newer-run', 'n26', '2026-07-02 00:00:00', 2),
					('older', 'older-run', 'n26', '2026-07-01 00:00:00', 1)`
			)
			.run();
		// Insert the newer child first so its rowid is lower than the older child.
		await db
			.prepare(
				`INSERT INTO import_batches (
					id, account_id, file_hash, adapter_id, import_run_id
				) VALUES
					('newer-batch', 'account', 'newer-batch', 'n26', 'newer'),
					('older-batch', 'account', 'older-batch', 'n26', 'older')`
			)
			.run();

		const runs = await listImportRuns(db);
		expect(runs.map((run) => [run.id, run.canDelete])).toEqual([
			['newer', true],
			['older', false]
		]);
		await expect(deleteImportRun(db, 'older')).rejects.toThrow(
			'Newer imports must be deleted first'
		);
		await deleteImportRun(db, 'newer');
		expect((await listImportRuns(db))[0]).toMatchObject({ id: 'older', canDelete: true });
		await db
			.prepare(
				`INSERT INTO import_runs (id, file_hash, adapter_id)
				VALUES ('following', 'following-run', 'n26')`
			)
			.run();
		expect(
			firstValue<number>(sqlite, "SELECT import_order FROM import_runs WHERE id='following'")
		).toBe(3);
	});
});
