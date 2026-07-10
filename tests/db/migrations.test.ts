import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applySql, createTestDatabase, firstValue, indexNames, tableNames } from './test-database';

const initialMigrationPath = resolve('migrations/0001_initial_schema.sql');
const seedCategoriesMigrationPath = resolve('migrations/0002_seed_default_categories.sql');
const subaccountMigrationPath = resolve('migrations/0003_add_transaction_subaccount.sql');

const expectedTables = [
	'account_balance_snapshots',
	'accounts',
	'categories',
	'category_rules',
	'contracts',
	'import_batches',
	'import_profiles',
	'import_row_errors',
	'marked_liabilities',
	'planned_income',
	'planned_payments',
	'recurring_group_transactions',
	'recurring_groups',
	'tags',
	'transaction_review_flags',
	'transaction_tags',
	'transactions'
];

describe('D1 migrations', () => {
	it('applies the initial schema with every V1 table', async () => {
		const db = await createTestDatabase();
		const migration = await readFile(initialMigrationPath, 'utf8');

		applySql(db, migration);

		expect(tableNames(db)).toEqual(expectedTables);
	});

	it('creates one-to-one account and import profile linkage', async () => {
		const db = await createTestDatabase();
		const migration = await readFile(initialMigrationPath, 'utf8');
		applySql(db, migration);

		db.run("INSERT INTO accounts (id, name) VALUES ('account-1', 'Main Giro')");
		db.run(
			"INSERT INTO import_profiles (id, account_id, bank_id, label) VALUES ('profile-1', 'account-1', 'dkb', 'DKB Giro')"
		);

		expect(() =>
			db.run(
				"INSERT INTO import_profiles (id, account_id, bank_id, label) VALUES ('profile-2', 'account-1', 'n26', 'Duplicate')"
			)
		).toThrow(/UNIQUE constraint failed/);
	});

	it('deduplicates transactions by profile and dedupe key', async () => {
		const db = await createTestDatabase();
		const migration = await readFile(initialMigrationPath, 'utf8');
		applySql(db, migration);

		db.run("INSERT INTO accounts (id, name) VALUES ('account-1', 'Main Giro')");
		db.run(
			"INSERT INTO import_profiles (id, account_id, bank_id, label) VALUES ('profile-1', 'account-1', 'dkb', 'DKB Giro')"
		);
		db.run(
			`INSERT INTO transactions (
				id, profile_id, account_id, dedupe_key, booking_date, amount_cents, search_text
			) VALUES (
				'txn-1', 'profile-1', 'account-1', 'dedupe-1', '2026-07-08', -1299, 'coffee'
			)`
		);

		expect(() =>
			db.run(
				`INSERT INTO transactions (
					id, profile_id, account_id, dedupe_key, booking_date, amount_cents, search_text
				) VALUES (
					'txn-2', 'profile-1', 'account-1', 'dedupe-1', '2026-07-08', -1299, 'coffee'
				)`
			)
		).toThrow(/UNIQUE constraint failed/);
	});

	it('cascades import batch deletion to transactions and row errors without storing raw rows', async () => {
		const db = await createTestDatabase();
		const migration = await readFile(initialMigrationPath, 'utf8');
		applySql(db, migration);

		db.run("INSERT INTO accounts (id, name) VALUES ('account-1', 'Main Giro')");
		db.run(
			"INSERT INTO import_profiles (id, account_id, bank_id, label) VALUES ('profile-1', 'account-1', 'dkb', 'DKB Giro')"
		);
		db.run(
			`INSERT INTO import_batches (
				id, profile_id, file_hash, adapter_id, row_count, imported_count
			) VALUES (
				'batch-1', 'profile-1', 'hash-1', 'dkb', 1, 0
			)`
		);
		db.run(
			`INSERT INTO import_row_errors (
				id, import_batch_id, profile_id, row_number, code, message
			) VALUES (
				'error-1', 'batch-1', 'profile-1', 12, 'invalid_amount', 'Amount is invalid'
			)`
		);
		db.run(
			`INSERT INTO transactions (
				id, profile_id, account_id, import_batch_id, dedupe_key, booking_date, amount_cents, search_text
			) VALUES (
				'txn-1', 'profile-1', 'account-1', 'batch-1', 'dedupe-1', '2026-07-08', -1299, 'coffee'
			)`
		);
		db.run("DELETE FROM import_batches WHERE id = 'batch-1'");

		expect(firstValue<number>(db, 'SELECT COUNT(*) FROM transactions')).toBe(0);
		expect(firstValue<number>(db, 'SELECT COUNT(*) FROM import_row_errors')).toBe(0);
		expect(
			firstValue<number>(
				db,
				"SELECT COUNT(*) FROM pragma_table_info('import_row_errors') WHERE name LIKE '%raw%'"
			)
		).toBe(0);
	});

	it('adds indexes for date, review, planning, and import queries', async () => {
		const db = await createTestDatabase();
		const migration = await readFile(initialMigrationPath, 'utf8');

		applySql(db, migration);

		expect(indexNames(db)).toEqual(
			expect.arrayContaining([
				'idx_transactions_account_date',
				'idx_transactions_review_status',
				'idx_import_batches_profile_created',
				'idx_contracts_status_next_date',
				'idx_planned_payments_due_date',
				'idx_planned_income_due_date',
				'idx_balance_snapshots_account_date'
			])
		);
	});

	it('seeds editable default categories without creating duplicates', async () => {
		const db = await createTestDatabase();
		const initialMigration = await readFile(initialMigrationPath, 'utf8');
		const seedCategoriesMigration = await readFile(seedCategoriesMigrationPath, 'utf8');

		applySql(db, initialMigration);
		applySql(db, seedCategoriesMigration);
		applySql(db, seedCategoriesMigration);

		expect(firstValue<number>(db, 'SELECT COUNT(*) FROM categories')).toBe(11);
		expect(
			firstValue<string>(
				db,
				"SELECT name FROM categories WHERE id = 'cat-unknown' AND type = 'unknown' AND is_default = 1"
			)
		).toBe('Unknown');
	});

	it('adds a nullable subaccount column to transactions with an account index', async () => {
		const db = await createTestDatabase();
		const initialMigration = await readFile(initialMigrationPath, 'utf8');
		const subaccountMigration = await readFile(subaccountMigrationPath, 'utf8');

		applySql(db, initialMigration);
		applySql(db, subaccountMigration);

		expect(
			firstValue<number>(
				db,
				"SELECT COUNT(*) FROM pragma_table_info('transactions') WHERE name = 'subaccount'"
			)
		).toBe(1);
		expect(indexNames(db)).toEqual(expect.arrayContaining(['idx_transactions_account_subaccount']));
	});
});
