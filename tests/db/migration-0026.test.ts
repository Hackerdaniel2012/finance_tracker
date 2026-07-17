import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	applyMigrations,
	applySql,
	createTestDatabase,
	firstValue,
	tableNames
} from './test-database';

let db: Awaited<ReturnType<typeof createTestDatabase>>;

beforeEach(async () => {
	db = await createTestDatabase();
	await applyMigrations(db, '0025_unify_account_balance_source.sql');
});

async function migrate(): Promise<void> {
	applySql(db, await readFile(resolve('migrations/0026_multi_account_import_runs.sql'), 'utf8'));
}

describe('migration 0026', () => {
	it('preserves trustworthy balances for accounts without an import', async () => {
		db.run(
			"INSERT INTO accounts (id, name, current_balance_cents) VALUES ('manual', 'Manual', 12345), ('empty', 'Empty', NULL)"
		);
		db.run(
			"INSERT INTO accounts (id, name, opening_balance_cents) VALUES ('history', 'History', 1000)"
		);
		db.run(
			"INSERT INTO transactions (id, account_id, dedupe_key, booking_date, amount_cents, search_text) VALUES ('t', 'history', 't', date('now'), -250, 'history')"
		);
		await migrate();

		expect(
			firstValue<number>(
				db,
				"SELECT balance_cents FROM account_balance_snapshots WHERE account_id='manual'"
			)
		).toBe(12345);
		expect(
			firstValue<number>(
				db,
				"SELECT balance_cents FROM account_balance_snapshots WHERE account_id='history'"
			)
		).toBe(750);
		expect(
			firstValue<number>(
				db,
				"SELECT COUNT(*) FROM account_balance_snapshots WHERE account_id='empty'"
			)
		).toBe(0);
	});

	it('splits legacy multi-key accounts while keeping plans and liabilities on the container', async () => {
		db.run("INSERT INTO accounts (id, name, institution) VALUES ('parent', 'N26', 'N26')");
		db.run(
			"INSERT INTO import_batches (id, account_id, file_hash, adapter_id, start_date, end_date, row_count, imported_count) VALUES ('batch', 'parent', 'hash', 'n26', '2026-07-01', '2026-07-03', 3, 3)"
		);
		db.run(`INSERT INTO transactions (id, account_id, import_batch_id, dedupe_key, booking_date, amount_cents, search_text, subaccount) VALUES
			('main', 'parent', 'batch', 'main', '2026-07-01', 1000, 'main', 'Main'),
			('savings', 'parent', 'batch', 'savings', '2026-07-02', 2000, 'savings', 'Savings'),
			('unknown', 'parent', 'batch', 'unknown', '2026-07-03', -100, 'unknown', NULL)`);
		db.run(
			"INSERT INTO plans (id, account_id, label, direction, cadence, amount_cents, next_date) VALUES ('plan', 'parent', 'Rent', 'expense', 'monthly', 50000, '2026-08-01')"
		);
		db.run(
			"INSERT INTO marked_liabilities (id, account_id, name, amount_cents, as_of_date) VALUES ('debt', 'parent', 'Debt', 10000, '2026-07-01')"
		);
		await migrate();

		expect(firstValue<number>(db, "SELECT COUNT(*) FROM accounts WHERE id <> 'parent'")).toBe(2);
		expect(
			firstValue<number>(
				db,
				'SELECT COUNT(DISTINCT account_id) FROM transactions WHERE source_account_key IS NOT NULL'
			)
		).toBe(2);
		expect(firstValue<string>(db, "SELECT account_id FROM transactions WHERE id='unknown'")).toBe(
			'parent'
		);
		expect(firstValue<string>(db, "SELECT account_id FROM plans WHERE id='plan'")).toBe('parent');
		expect(
			firstValue<string>(db, "SELECT account_id FROM marked_liabilities WHERE id='debt'")
		).toBe('parent');
		expect(
			firstValue<number>(
				db,
				"SELECT COUNT(*) FROM account_balance_snapshots WHERE account_id='parent'"
			)
		).toBe(0);
		expect(firstValue<number>(db, 'SELECT COUNT(*) FROM import_runs')).toBe(1);
		expect(firstValue<string>(db, "SELECT import_batch_id FROM transactions WHERE id='unknown'")).toBe(
			'batch'
		);
		expect(firstValue<string>(db, "SELECT account_id FROM import_batches WHERE id='batch'")).toBe(
			'parent'
		);
		expect(firstValue<number>(db, "SELECT row_count FROM import_batches WHERE id='batch'")).toBe(
			1
		);
		expect(firstValue<number>(db, 'SELECT COUNT(*) FROM import_batches')).toBe(3);
		expect(firstValue<number>(db, 'SELECT COUNT(*) FROM import_batches WHERE import_run_id = \'legacy-run:batch\'')).toBe(3);
		expect(db.exec('PRAGMA foreign_key_check')).toEqual([]);
		expect(firstValue<number>(db, 'SELECT COUNT(*) FROM import_account_mappings')).toBe(2);
		expect(tableNames(db)).toEqual(
			expect.arrayContaining(['import_runs', 'import_account_mappings'])
		);

		expect(firstValue<number>(db, 'SELECT COUNT(DISTINCT import_run_id) FROM import_batches')).toBe(
			1
		);
		expect(
			firstValue<number>(
				db,
				"SELECT COUNT(*) FROM import_batches WHERE import_run_id = 'legacy-run:batch'"
			)
		).toBe(3);
		expect(firstValue<number>(db, 'SELECT COUNT(*) FROM import_file_claims')).toBe(1);
		expect(db.exec('PRAGMA foreign_key_check')).toEqual([]);
	});
});
