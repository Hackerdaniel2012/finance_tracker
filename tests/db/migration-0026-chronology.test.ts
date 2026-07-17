import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { listCalculatedAccountBalances } from '../../src/lib/server/accounts/balance';
import { deleteImportRun, listImportRuns } from '../../src/lib/server/imports/repository';
import {
	applyMigrations,
	applySql,
	createTestDatabase,
	createTestDbClient,
	firstValue
} from './test-database';

async function applyMigration0026(
	database: Awaited<ReturnType<typeof createTestDatabase>>
): Promise<void> {
	applySql(
		database,
		await readFile(resolve('migrations/0026_multi_account_import_runs.sql'), 'utf8')
	);
}

describe('migration 0026 balance and chronology repair', () => {
	it('moves generated manual balance anchors to today without changing their balance', async () => {
		const database = await createTestDatabase();
		await applyMigrations(database, '0024_add_liability_balance_baselines.sql');
		database.run(
			`INSERT INTO accounts (id, name, current_balance_cents)
			VALUES ('manual', 'Manual', 100000), ('computed', 'Computed', NULL),
				('existing', 'Existing manual', 70000)`
		);
		database.run(
			`INSERT INTO import_batches (
				id, account_id, file_hash, adapter_id, start_date, end_date, created_at
			) VALUES
				('manual-first', 'manual', 'm1', 'n26', '2026-01-01', '2026-01-31', '2026-02-01'),
				('manual-later', 'manual', 'm2', 'n26', '2026-02-01', '2026-02-28', '2026-03-01'),
				('computed-first', 'computed', 'c1', 'n26', '2026-01-01', '2026-01-31', '2026-02-01')`
		);
		database.run(
			`INSERT INTO transactions (
				id, account_id, import_batch_id, dedupe_key, booking_date, amount_cents, search_text
			) VALUES
				('manual-one', 'manual', 'manual-first', 'm-one', '2026-01-10', 1000, ''),
				('manual-two', 'manual', 'manual-later', 'm-two', '2026-02-10', -5000, ''),
				('computed-one', 'computed', 'computed-first', 'c-one', '2026-01-10', 3000, '')`
		);
		database.run(
			`INSERT INTO account_balance_snapshots (
				id, account_id, snapshot_date, balance_cents, source
			) VALUES ('existing-snapshot', 'existing', '2026-06-01', 70000, 'manual')`
		);

		applySql(
			database,
			await readFile(resolve('migrations/0025_unify_account_balance_source.sql'), 'utf8')
		);
		await applyMigration0026(database);

		expect(
			firstValue<string>(
				database,
				`SELECT snapshot_date || ':' || balance_cents || ':' || source || ':' ||
					COALESCE(anchor_import_batch_id, 'null')
				FROM account_balance_snapshots WHERE id = 'balance-anchor:manual'`
			)
		).toBe(`${new Date().toISOString().slice(0, 10)}:100000:manual:null`);
		expect(
			firstValue<number>(
				database,
				"SELECT reported_balance_cents IS NULL FROM import_batches WHERE id='manual-first'"
			)
		).toBe(1);
		expect(
			firstValue<string>(
				database,
				`SELECT source || ':' || anchor_import_batch_id
				FROM account_balance_snapshots WHERE id = 'balance-anchor:computed'`
			)
		).toBe('imported:computed-first');
		expect(
			firstValue<string>(
				database,
				`SELECT snapshot_date || ':' || balance_cents || ':' || source
				FROM account_balance_snapshots WHERE id = 'existing-snapshot'`
			)
		).toBe('2026-06-01:70000:manual');

		const db = createTestDbClient(database);
		expect(
			(await listCalculatedAccountBalances(db, new Date().toISOString().slice(0, 10), 'manual'))[0]
				?.balanceCents
		).toBe(100000);
	});

	it('assigns deterministic orders and retains a high-water mark', async () => {
		const database = await createTestDatabase();
		await applyMigrations(database, '0025_unify_account_balance_source.sql');
		database.run(
			"INSERT INTO accounts (id, name) VALUES ('one', 'One'), ('two', 'Two'), ('three', 'Three')"
		);
		database.run(
			`INSERT INTO import_batches (id, account_id, file_hash, adapter_id, created_at) VALUES
				('same-first', 'one', 'one', 'n26', '2026-07-01 00:00:00'),
				('same-second', 'two', 'two', 'n26', '2026-07-01 00:00:00'),
				('later', 'three', 'three', 'n26', '2026-07-02 00:00:00')`
		);

		await applyMigration0026(database);

		expect(
			database.exec('SELECT id, import_order FROM import_runs ORDER BY import_order')[0]?.values
		).toEqual([
			['legacy-run:same-first', 1],
			['legacy-run:same-second', 2],
			['legacy-run:later', 3]
		]);
		database.run("DELETE FROM import_runs WHERE id='legacy-run:later'");
		database.run(
			"INSERT INTO import_runs (id, file_hash, adapter_id) VALUES ('next', 'four', 'n26')"
		);
		expect(firstValue<number>(database, "SELECT import_order FROM import_runs WHERE id='next'")).toBe(
			4
		);
	});

	it('keeps repeated historical uploads separate and preserves their chronology', async () => {
		const database = await createTestDatabase();
		await applyMigrations(database, '0025_unify_account_balance_source.sql');
		database.run(
			"INSERT INTO accounts (id, name) VALUES ('first-account', 'First'), ('second-account', 'Second')"
		);
		database.run(
			`INSERT INTO import_batches (
				id, account_id, file_hash, adapter_id, start_date, end_date,
				row_count, imported_count, duplicate_count, error_count, created_at
			) VALUES
				('first-batch', 'first-account', 'same-file', 'n26', '2026-06-01', '2026-06-01', 1, 1, 0, 0, '2026-07-01 00:00:00'),
				('between-batch', 'second-account', 'between-file', 'n26', '2026-06-03', '2026-06-03', 1, 1, 0, 0, '2026-07-02 00:00:00'),
				('second-batch', 'second-account', 'same-file', 'n26', '2026-06-03', '2026-06-03', 1, 1, 0, 0, '2026-07-03 00:00:00')`
		);
		database.run(
			`INSERT INTO transactions (
				id, account_id, import_batch_id, dedupe_key, booking_date, amount_cents, search_text
			) VALUES
				('first-row', 'first-account', 'first-batch', 'first-row', '2026-06-01', 100, ''),
				('between-row', 'second-account', 'between-batch', 'between-row', '2026-06-03', 1000, ''),
				('second-row', 'second-account', 'second-batch', 'second-row', '2026-06-03', 200, '')`
		);
		database.run(
			`INSERT INTO account_balance_snapshots (
				id, account_id, snapshot_date, balance_cents, source, anchor_import_batch_id
			) VALUES (
				'between-snapshot', 'second-account', '2026-06-03', 1000, 'imported', 'between-batch'
			)`
		);

		await applyMigration0026(database);

		expect(
			database.exec('SELECT id, import_order FROM import_runs ORDER BY import_order')[0]?.values
		).toEqual([
			['legacy-run:first-batch', 1],
			['legacy-run:between-batch', 2],
			['legacy-run:second-batch', 3]
		]);
		expect(
			(await listCalculatedAccountBalances(
				createTestDbClient(database),
				'2026-06-03',
				'second-account'
			))[0]?.balanceCents
		).toBe(1200);
		expect(
			database.exec(
				'SELECT file_hash, import_run_id FROM import_file_claims ORDER BY file_hash'
			)[0]?.values
		).toEqual([
			['between-file', 'legacy-run:between-batch'],
			['same-file', 'legacy-run:second-batch']
		]);

		const db = createTestDbClient(database);
		expect((await listImportRuns(db)).map((run) => [run.id, run.canDelete])).toEqual([
			['legacy-run:second-batch', true],
			['legacy-run:between-batch', false],
			['legacy-run:first-batch', true]
		]);
		await expect(deleteImportRun(db, 'legacy-run:between-batch')).rejects.toThrow(
			'Newer imports must be deleted first'
		);
		await deleteImportRun(db, 'legacy-run:second-batch');
		expect(
			(await listImportRuns(db)).find((run) => run.id === 'legacy-run:between-batch')
		).toMatchObject({ canDelete: true });
		expect(database.exec('PRAGMA foreign_key_check')).toEqual([]);
	});
});
