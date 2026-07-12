import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applySql, createTestDatabase, firstValue, indexNames, tableNames } from './test-database';

const initialMigrationPath = resolve('migrations/0001_initial_schema.sql');
const seedCategoriesMigrationPath = resolve('migrations/0002_seed_default_categories.sql');
const subaccountMigrationPath = resolve('migrations/0003_add_transaction_subaccount.sql');
const recurringV2MigrationPath = resolve('migrations/0004_recurring_detector_v2.sql');
const recurringLabelsMigrationPath = resolve('migrations/0006_add_recurring_labels.sql');
const dkbCreditcardMigrationPath = resolve('migrations/0007_add_dkb_creditcard_scheme.sql');
const dkbNamingMigrationPath = resolve(
	'migrations/0008_rename_dkb_girocard_remove_profile_label.sql'
);
const profileRemovalMigrationPath = resolve('migrations/0009_remove_import_profiles.sql');

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
	it('removes profiles while preserving all account-owned data and relationships', async () => {
		const db = await createTestDatabase();
		applySql(db, await readFile(initialMigrationPath, 'utf8'));
		applySql(db, await readFile(subaccountMigrationPath, 'utf8'));
		applySql(db, await readFile(recurringV2MigrationPath, 'utf8'));
		applySql(db, await readFile(recurringLabelsMigrationPath, 'utf8'));
		applySql(db, await readFile(dkbCreditcardMigrationPath, 'utf8'));
		applySql(db, await readFile(dkbNamingMigrationPath, 'utf8'));
		db.run("INSERT INTO accounts (id, name) VALUES ('account-1', 'Main Giro')");
		db.run("INSERT INTO categories (id, name, type) VALUES ('category-1', 'Groceries', 'expense')");
		db.run(
			"INSERT INTO import_profiles (id, account_id, bank_id) VALUES ('profile-1', 'account-1', 'dkb_girocard')"
		);
		db.run(
			"INSERT INTO import_batches (id, profile_id, file_hash, adapter_id) VALUES ('batch-1', 'profile-1', 'hash-1', 'dkb_girocard')"
		);
		db.run("INSERT INTO tags (id, name) VALUES ('tag-1', 'Essential')");
		db.run(`INSERT INTO transactions (
			id, profile_id, account_id, import_batch_id, category_id, dedupe_key, booking_date,
			amount_cents, note, search_text, classification_status, created_at, updated_at
		) VALUES (
			'txn-1', 'profile-1', 'account-1', 'batch-1', 'category-1', 'dedupe-1', '2026-07-01',
			-1234, 'keep me', 'shop', 'manual', '2026-07-02 03:04:05', '2026-07-03 04:05:06'
		)`);
		db.run(
			"INSERT INTO import_row_errors (id, import_batch_id, profile_id, row_number, code, message) VALUES ('error-1', 'batch-1', 'profile-1', 7, 'invalid_amount', 'Bad amount')"
		);
		db.run("INSERT INTO transaction_tags (transaction_id, tag_id) VALUES ('txn-1', 'tag-1')");
		db.run(
			"INSERT INTO transaction_review_flags (id, transaction_id, reason) VALUES ('flag-1', 'txn-1', 'manual_review')"
		);
		db.run(
			"INSERT INTO recurring_groups (id, profile_id, category_id, label, payee, direction, canonical_payee_key, cadence, expected_amount_cents, source) VALUES ('group-1', 'profile-1', 'category-1', 'Power', 'Power Co', 'outgoing', 'power co', 'monthly', 1234, 'imported')"
		);
		db.run(
			"INSERT INTO recurring_group_transactions (recurring_group_id, transaction_id) VALUES ('group-1', 'txn-1')"
		);
		db.run(
			"INSERT INTO contracts (id, profile_id, category_id, name, kind, cadence, expected_amount_cents, next_date) VALUES ('contract-1', 'profile-1', 'category-1', 'Gym', 'subscription', 'monthly', 2500, '2026-08-01')"
		);

		applySql(db, await readFile(profileRemovalMigrationPath, 'utf8'));

		expect(tableNames(db)).not.toContain('import_profiles');
		expect(firstValue<number>(db, 'SELECT COUNT(*) FROM accounts')).toBe(1);
		expect(firstValue<number>(db, 'SELECT COUNT(*) FROM categories')).toBe(1);
		expect(
			firstValue<string>(
				db,
				"SELECT account_id || ':' || adapter_id FROM import_batches WHERE id = 'batch-1'"
			)
		).toBe('account-1:dkb_girocard');
		expect(
			firstValue<string>(
				db,
				"SELECT account_id || ':' || note || ':' || classification_status FROM transactions WHERE id = 'txn-1'"
			)
		).toBe('account-1:keep me:manual');
		expect(firstValue<number>(db, 'SELECT COUNT(*) FROM import_row_errors')).toBe(1);
		expect(firstValue<number>(db, 'SELECT COUNT(*) FROM transaction_tags')).toBe(1);
		expect(firstValue<number>(db, 'SELECT COUNT(*) FROM transaction_review_flags')).toBe(1);
		expect(firstValue<number>(db, 'SELECT COUNT(*) FROM recurring_group_transactions')).toBe(1);
		expect(
			firstValue<string>(db, "SELECT account_id FROM recurring_groups WHERE id = 'group-1'")
		).toBe('account-1');
		expect(firstValue<string>(db, "SELECT account_id FROM contracts WHERE id = 'contract-1'")).toBe(
			'account-1'
		);
		expect(firstValue<number>(db, 'SELECT COUNT(*) FROM pragma_foreign_key_check')).toBe(0);
		expect(indexNames(db)).toEqual(
			expect.arrayContaining([
				'idx_import_batches_account_created',
				'idx_transactions_account_date'
			])
		);

		db.run("DELETE FROM accounts WHERE id = 'account-1'");
		expect(firstValue<number>(db, 'SELECT COUNT(*) FROM import_batches')).toBe(0);
		expect(firstValue<number>(db, 'SELECT COUNT(*) FROM transactions')).toBe(0);
		expect(firstValue<number>(db, 'SELECT COUNT(*) FROM recurring_groups')).toBe(0);
		expect(
			firstValue<number>(
				db,
				"SELECT COUNT(*) FROM contracts WHERE id = 'contract-1' AND account_id IS NULL"
			)
		).toBe(1);
	});
	it('adds the DKB credit card scheme while preserving existing profiles and batches', async () => {
		const db = await createTestDatabase();
		applySql(db, await readFile(initialMigrationPath, 'utf8'));
		db.run(
			"INSERT INTO accounts (id, name) VALUES ('account-1', 'Main Giro'), ('account-2', 'Credit Card')"
		);
		db.run(
			"INSERT INTO import_profiles (id, account_id, bank_id, label) VALUES ('profile-1', 'account-1', 'dkb', 'DKB Giro')"
		);
		db.run(
			"INSERT INTO import_batches (id, profile_id, file_hash, adapter_id) VALUES ('batch-1', 'profile-1', 'hash-1', 'dkb')"
		);

		applySql(db, await readFile(dkbCreditcardMigrationPath, 'utf8'));
		db.run(
			"INSERT INTO import_profiles (id, account_id, bank_id, label) VALUES ('profile-2', 'account-2', 'dkb_creditcard', 'DKB Credit Card')"
		);
		db.run(
			"INSERT INTO import_batches (id, profile_id, file_hash, adapter_id) VALUES ('batch-2', 'profile-2', 'hash-2', 'dkb_creditcard')"
		);

		expect(
			firstValue<string>(db, "SELECT bank_id FROM import_profiles WHERE id = 'profile-1'")
		).toBe('dkb');
		expect(
			firstValue<string>(db, "SELECT adapter_id FROM import_batches WHERE id = 'batch-1'")
		).toBe('dkb');
	});

	it('adds nullable labels to recurring groups', async () => {
		const db = await createTestDatabase();
		applySql(db, await readFile(initialMigrationPath, 'utf8'));
		applySql(db, await readFile(recurringLabelsMigrationPath, 'utf8'));

		db.run(
			"INSERT INTO recurring_groups (id, payee, cadence, expected_amount_cents) VALUES ('group-1', 'Rent', 'monthly', 100000)"
		);
		db.run("UPDATE recurring_groups SET label = 'Home rent' WHERE id = 'group-1'");

		expect(firstValue<string>(db, "SELECT label FROM recurring_groups WHERE id = 'group-1'")).toBe(
			'Home rent'
		);
	});

	it('renames the DKB girocard scheme and removes import profile labels', async () => {
		const db = await createTestDatabase();
		applySql(db, await readFile(initialMigrationPath, 'utf8'));
		applySql(db, await readFile(dkbCreditcardMigrationPath, 'utf8'));
		db.run("INSERT INTO accounts (id, name) VALUES ('account-1', 'Main Giro')");
		db.run(
			"INSERT INTO import_profiles (id, account_id, bank_id, label) VALUES ('profile-1', 'account-1', 'dkb', 'Old label')"
		);
		db.run(
			"INSERT INTO import_batches (id, profile_id, file_hash, adapter_id) VALUES ('batch-1', 'profile-1', 'hash-1', 'dkb')"
		);

		applySql(db, await readFile(dkbNamingMigrationPath, 'utf8'));

		expect(
			firstValue<string>(db, "SELECT bank_id FROM import_profiles WHERE id = 'profile-1'")
		).toBe('dkb_girocard');
		expect(
			firstValue<string>(db, "SELECT adapter_id FROM import_batches WHERE id = 'batch-1'")
		).toBe('dkb_girocard');
		expect(
			firstValue<number>(
				db,
				"SELECT COUNT(*) FROM pragma_table_info('import_profiles') WHERE name = 'label'"
			)
		).toBe(0);
	});

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

	it('backfills recurring direction, quarantines ambiguous confirmations, and removes suggestions', async () => {
		const db = await createTestDatabase();
		applySql(db, await readFile(initialMigrationPath, 'utf8'));
		db.run("INSERT INTO accounts (id, name) VALUES ('account-1', 'Main')");
		db.run(
			"INSERT INTO import_profiles (id, account_id, bank_id, label) VALUES ('profile-1', 'account-1', 'n26', 'Main')"
		);
		db.run(
			"INSERT INTO transactions (id, profile_id, account_id, dedupe_key, booking_date, amount_cents, payee, search_text) VALUES ('txn-1', 'profile-1', 'account-1', 'one', '2026-06-01', -5000, 'Power Co', 'power')"
		);
		db.run(
			"INSERT INTO recurring_groups (id, account_id, payee, cadence, expected_amount_cents, status, confidence) VALUES ('confirmed-1', 'account-1', 'Power Co', 'monthly', 5000, 'confirmed', 90), ('suggested-1', 'account-1', 'Gym', 'monthly', 2000, 'suggested', 80), ('ignored-1', 'account-1', 'Old Service', 'monthly', 1000, 'ignored', 70)"
		);
		db.run(
			"INSERT INTO recurring_group_transactions (recurring_group_id, transaction_id) VALUES ('confirmed-1', 'txn-1')"
		);

		applySql(db, await readFile(recurringV2MigrationPath, 'utf8'));

		expect(
			firstValue<number>(db, "SELECT COUNT(*) FROM recurring_groups WHERE id = 'suggested-1'")
		).toBe(0);
		expect(
			firstValue<string>(db, "SELECT direction FROM recurring_groups WHERE id = 'confirmed-1'")
		).toBe('outgoing');
		expect(
			firstValue<number>(db, "SELECT needs_review FROM recurring_groups WHERE id = 'confirmed-1'")
		).toBe(1);
		expect(
			firstValue<number>(db, "SELECT COUNT(*) FROM recurring_groups WHERE id = 'ignored-1'")
		).toBe(1);
	});
});
