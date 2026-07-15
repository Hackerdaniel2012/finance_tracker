import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	applyMigrations,
	applySql,
	createTestDatabase,
	firstValue,
	indexNames,
	tableNames
} from './test-database';

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
const dkbDeduplicationMigrationPath = resolve(
	'migrations/0010_fix_dkb_reference_deduplication.sql'
);
const dkbCreditcardDeduplicationMigrationPath = resolve(
	'migrations/0011_preserve_repeated_dkb_creditcard_charges.sql'
);
const dailyCadenceMigrationPath = resolve('migrations/0012_add_daily_recurring_cadence.sql');
const recurringEndDateMigrationPath = resolve('migrations/0013_add_recurring_end_date.sql');
const vehiclesCategoryMigrationPath = resolve('migrations/0014_seed_vehicles_category.sql');
const developmentCategoryMigrationPath = resolve('migrations/0015_seed_development_category.sql');
const repaymentsCategoryMigrationPath = resolve(
	'migrations/0017_replace_subscriptions_with_repayments.sql'
);
const installmentPlanMigrationPath = resolve(
	'migrations/0018_rename_repayments_to_installment_plan.sql'
);
const liabilityInterestMigrationPath = resolve('migrations/0019_add_liability_interest.sql');
const telecommunicationsMigrationPath = resolve(
	'migrations/0020_add_telecommunications_category.sql'
);
const shoppingMigrationPath = resolve('migrations/0021_add_shopping_category.sql');
const planMatchLedgerMigrationPath = resolve('migrations/0022_add_plan_match_ledger.sql');
const planDeduplicationRepairMigrationPath = resolve(
	'migrations/0023_repair_plan_migration_duplicates.sql'
);
const liabilityBaselineMigrationPath = resolve(
	'migrations/0024_add_liability_balance_baselines.sql'
);
const importCombinationMigrationPath = resolve('migrations/0025_add_import_combination.sql');

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
	it('adds combined import metadata and cascaded source fingerprints without changing old rows', async () => {
		const db = await createTestDatabase();
		await applyMigrations(db, '0024_add_liability_balance_baselines.sql');
		db.run("INSERT INTO accounts (id, name) VALUES ('combine-account', 'Main')");
		db.run(`INSERT INTO import_batches (
			id, account_id, file_hash, adapter_id, row_count, imported_count
		) VALUES ('combine-batch', 'combine-account', 'hash', 'n26', 1, 1)`);
		db.run(`INSERT INTO transactions (
			id, account_id, import_batch_id, dedupe_key, booking_date, amount_cents, search_text
		) VALUES ('combine-transaction', 'combine-account', 'combine-batch', 'source-key', '2025-12-31', 100, '')`);

		applySql(db, await readFile(importCombinationMigrationPath, 'utf8'));

		expect(
			firstValue<string>(db, "SELECT kind FROM transactions WHERE id = 'combine-transaction'")
		).toBe('standard');
		expect(
			firstValue<number>(
				db,
				"SELECT detailed_import_count FROM import_batches WHERE id = 'combine-batch'"
			)
		).toBe(1);
		db.run(`INSERT INTO import_source_fingerprints (account_id, import_batch_id, dedupe_key)
			VALUES ('combine-account', 'combine-batch', 'old-source-key')`);
		db.run("DELETE FROM import_batches WHERE id = 'combine-batch'");
		expect(firstValue<number>(db, 'SELECT COUNT(*) FROM import_source_fingerprints')).toBe(0);
		expect(indexNames(db)).toContain('idx_import_source_fingerprints_batch');
	});

	it('repairs only semantically distinct contract and recurring-plan migrations', async () => {
		const db = await createTestDatabase();
		await applyMigrations(db, '0022_add_plan_match_ledger.sql');
		db.run("INSERT INTO accounts (id,name) VALUES ('repair-account','Repair')");
		db.run(`INSERT INTO plans (id,account_id,label,counterparty,direction,cadence,amount_cents,next_date,end_date,status,source,schedule_anchor_date,manual_status)
			VALUES ('contract-plan','repair-account','Contract','Power Co','expense','monthly',5000,'2026-08-01',NULL,'active','migrated','2026-08-01','active')`);
		db.run(`INSERT INTO recurring_groups (id,account_id,label,payee,direction,cadence,expected_amount_cents,next_date,end_date,status,plan_id)
			VALUES ('different-group','repair-account','Other label','Power Co','outgoing','monthly',5000,'2026-08-01','2026-12-01','confirmed','contract-plan'),
			('same-group','repair-account','Contract','Power Co','outgoing','monthly',5000,'2026-08-01',NULL,'confirmed','contract-plan')`);
		applySql(db, await readFile(planDeduplicationRepairMigrationPath, 'utf8'));
		expect(
			firstValue<string>(db, "SELECT plan_id FROM recurring_groups WHERE id='different-group'")
		).toBe('recurring-repair:different-group');
		expect(
			firstValue<string>(db, "SELECT plan_id FROM recurring_groups WHERE id='same-group'")
		).toBe('contract-plan');
		expect(
			firstValue<number>(db, "SELECT COUNT(*) FROM plans WHERE id LIKE 'recurring-repair:%'")
		).toBe(1);
	});

	it('creates a liability baseline from the first automatic snapshot', async () => {
		const db = await createTestDatabase();
		await applyMigrations(db, '0022_add_plan_match_ledger.sql');
		db.run(
			"INSERT INTO marked_liabilities (id,name,amount_cents,as_of_date) VALUES ('baseline-loan','Loan',9000,'2026-07-10')"
		);
		db.run(`INSERT INTO plans (id,direction,cadence,amount_cents,next_date,liability_id,schedule_anchor_date,manual_status)
			VALUES ('baseline-plan','expense','monthly',1000,'2026-07-01','baseline-loan','2026-07-01','active')`);
		db.run("INSERT INTO accounts (id,name) VALUES ('baseline-account','Account')");
		db.run(
			"INSERT INTO transactions (id,account_id,dedupe_key,booking_date,amount_cents,search_text) VALUES ('baseline-payment','baseline-account','baseline-payment','2026-07-10',-1000,'')"
		);
		db.run(`INSERT INTO plan_transactions (plan_id,transaction_id,match_kind,scheduled_date,occurrence_index,liability_id,liability_amount_before,liability_as_of_date_before)
			VALUES ('baseline-plan','baseline-payment','automatic','2026-07-10',0,'baseline-loan',10000,'2026-07-01')`);
		applySql(db, await readFile(liabilityBaselineMigrationPath, 'utf8'));
		expect(
			firstValue<string>(
				db,
				"SELECT amount_cents || ':' || as_of_date FROM liability_balance_baselines WHERE liability_id='baseline-loan'"
			)
		).toBe('10000:2026-07-01');
	});
	it('adds Shopping and categorizes only Amazon Prime memberships', async () => {
		const db = await createTestDatabase();
		await applyMigrations(db, '0020_add_telecommunications_category.sql');
		db.run("INSERT INTO accounts (id, name) VALUES ('shopping-account', 'Main')");
		db.run(`INSERT INTO transactions (
			id, account_id, dedupe_key, booking_date, amount_cents, payee, description,
			search_text, classification_status
		) VALUES
			('prime-auto', 'shopping-account', 'prime-auto', '2026-07-01', -899,
				'Amazon EU', 'D01-123 AMZNPrime DE', 'amazon amznprime', 'unknown'),
			('amazon-order', 'shopping-account', 'amazon-order', '2026-07-02', -4999,
				'Amazon EU', 'Order 123-456', 'amazon order', 'unknown'),
			('prime-manual', 'shopping-account', 'prime-manual', '2026-07-03', -899,
				'Amazon EU', 'Amazon Prime membership', 'amazon prime', 'manual')
		`);
		db.run(`INSERT INTO transaction_review_flags (id, transaction_id, reason)
			VALUES ('prime-review', 'prime-auto', 'unknown_category')`);
		db.run(`INSERT INTO recurring_groups (
			id, account_id, payee, direction, cadence, expected_amount_cents, status, needs_review
		) VALUES (
			'prime-suggestion', 'shopping-account', 'Amazon EU', 'outgoing', 'monthly', 899,
			'suggested', 1
		)`);
		db.run(`INSERT INTO recurring_group_transactions (recurring_group_id, transaction_id)
			VALUES ('prime-suggestion', 'prime-auto')`);

		applySql(db, await readFile(shoppingMigrationPath, 'utf8'));

		expect(
			firstValue<string>(
				db,
				"SELECT name || ':' || type || ':' || icon FROM categories WHERE id = 'cat-shopping'"
			)
		).toBe('Shopping:expense:shopping-bag');
		expect(
			firstValue<string>(
				db,
				"SELECT category_id || ':' || classification_status FROM transactions WHERE id = 'prime-auto'"
			)
		).toBe('cat-shopping:auto');
		expect(
			firstValue<string>(
				db,
				"SELECT COALESCE(category_id, 'null') || ':' || classification_status FROM transactions WHERE id = 'amazon-order'"
			)
		).toBe('null:unknown');
		expect(
			firstValue<string>(
				db,
				"SELECT COALESCE(category_id, 'null') || ':' || classification_status FROM transactions WHERE id = 'prime-manual'"
			)
		).toBe('null:manual');
		expect(
			firstValue<string>(
				db,
				"SELECT status FROM transaction_review_flags WHERE id = 'prime-review'"
			)
		).toBe('resolved');
		expect(
			firstValue<string>(
				db,
				"SELECT category_id || ':' || needs_review FROM recurring_groups WHERE id = 'prime-suggestion'"
			)
		).toBe('cat-shopping:0');
		expect(firstValue<number>(db, 'SELECT COUNT(*) FROM pragma_foreign_key_check')).toBe(0);
	});

	it('adds Telecommunications and moves only automatic telecom classifications', async () => {
		const db = await createTestDatabase();
		await applyMigrations(db, '0019_add_liability_interest.sql');
		db.run("INSERT INTO accounts (id, name) VALUES ('telecom-account', 'Main')");
		db.run(`INSERT INTO transactions (
			id, account_id, category_id, dedupe_key, booking_date, amount_cents,
			payee, search_text, classification_status
		) VALUES
			('telecom-auto', 'telecom-account', 'cat-utilities', 'telecom-auto', '2026-07-01', -4350, 'Telekom Deutschland GmbH', 'telekom deutschland', 'auto'),
			('telecom-manual', 'telecom-account', 'cat-utilities', 'telecom-manual', '2026-07-02', -4350, 'Telekom Deutschland GmbH', 'telekom deutschland', 'manual'),
			('power-auto', 'telecom-account', 'cat-utilities', 'power-auto', '2026-07-03', -6000, 'Power Co', 'power co', 'auto')
		`);
		db.run(`INSERT INTO recurring_groups (
			id, account_id, category_id, payee, direction, cadence, expected_amount_cents, status
		) VALUES
			('telecom-suggested', 'telecom-account', 'cat-utilities', 'Telekom Deutschland GmbH', 'outgoing', 'monthly', 4350, 'suggested'),
			('telecom-confirmed', 'telecom-account', 'cat-utilities', 'Telekom Deutschland GmbH', 'outgoing', 'monthly', 4350, 'confirmed')
		`);

		applySql(db, await readFile(telecommunicationsMigrationPath, 'utf8'));

		expect(
			firstValue<string>(
				db,
				"SELECT name || ':' || type || ':' || icon FROM categories WHERE id = 'cat-telecommunications'"
			)
		).toBe('Telecommunications:expense:smartphone');
		expect(
			firstValue<string>(db, "SELECT category_id FROM category_rules WHERE id = 'rule-telecom'")
		).toBe('cat-telecommunications');
		expect(
			firstValue<string>(db, "SELECT category_id FROM transactions WHERE id = 'telecom-auto'")
		).toBe('cat-telecommunications');
		expect(
			firstValue<string>(db, "SELECT category_id FROM transactions WHERE id = 'telecom-manual'")
		).toBe('cat-utilities');
		expect(
			firstValue<string>(db, "SELECT category_id FROM transactions WHERE id = 'power-auto'")
		).toBe('cat-utilities');
		expect(
			firstValue<string>(
				db,
				"SELECT category_id FROM recurring_groups WHERE id = 'telecom-suggested'"
			)
		).toBe('cat-telecommunications');
		expect(
			firstValue<string>(
				db,
				"SELECT category_id FROM recurring_groups WHERE id = 'telecom-confirmed'"
			)
		).toBe('cat-utilities');
		expect(firstValue<number>(db, 'SELECT COUNT(*) FROM pragma_foreign_key_check')).toBe(0);
	});

	it('adds liability interest and plan links while preserving existing liabilities', async () => {
		const db = await createTestDatabase();
		await applyMigrations(db, '0018_rename_repayments_to_installment_plan.sql');
		db.run("INSERT INTO accounts (id, name) VALUES ('loan-account', 'Loan account')");
		db.run(`INSERT INTO marked_liabilities (
			id, account_id, name, amount_cents, as_of_date, status, note
		) VALUES (
			'loan-1', 'loan-account', 'Car loan', 800000, '2026-07-12', 'active', 'Keep me'
		)`);
		db.run(`INSERT INTO plans (
			id, account_id, category_id, direction, cadence, amount_cents, next_date
		) VALUES (
			'loan-plan', 'loan-account', 'cat-installment-plan', 'expense', 'monthly',
			25000, '2026-08-01'
		)`);

		applySql(db, await readFile(liabilityInterestMigrationPath, 'utf8'));

		expect(
			firstValue<string>(
				db,
				"SELECT name || ':' || amount_cents || ':' || COALESCE(annual_interest_rate_bps, 'null') || ':' || note FROM marked_liabilities WHERE id = 'loan-1'"
			)
		).toBe('Car loan:800000:null:Keep me');
		db.run("UPDATE marked_liabilities SET annual_interest_rate_bps = 599 WHERE id = 'loan-1'");
		db.run("UPDATE plans SET liability_id = 'loan-1' WHERE id = 'loan-plan'");
		expect(firstValue<string>(db, "SELECT liability_id FROM plans WHERE id = 'loan-plan'")).toBe(
			'loan-1'
		);
		expect(firstValue<number>(db, 'SELECT COUNT(*) FROM pragma_foreign_key_check')).toBe(0);
	});

	it('adds reconstructable plan match metadata without replaying existing evidence', async () => {
		const db = await createTestDatabase();
		await applyMigrations(db, '0021_add_shopping_category.sql');
		db.run("INSERT INTO accounts (id, name) VALUES ('ledger-account', 'Ledger account')");
		db.run(`INSERT INTO plans (
			id, account_id, direction, cadence, amount_cents, next_date, status
		) VALUES (
			'ledger-plan', 'ledger-account', 'expense', 'monthly', 1000, '2026-08-31', 'active'
		)`);
		db.run(`INSERT INTO transactions (
			id, account_id, dedupe_key, booking_date, amount_cents, search_text
		) VALUES (
			'ledger-evidence', 'ledger-account', 'ledger-evidence', '2026-07-31', -1000, ''
		)`);
		db.run(
			"INSERT INTO plan_transactions (plan_id, transaction_id) VALUES ('ledger-plan', 'ledger-evidence')"
		);

		applySql(db, await readFile(planMatchLedgerMigrationPath, 'utf8'));

		expect(
			firstValue<string>(
				db,
				"SELECT schedule_anchor_date || ':' || schedule_occurrence_index || ':' || manual_status FROM plans WHERE id = 'ledger-plan'"
			)
		).toBe('2026-08-31:0:active');
		expect(
			firstValue<string>(
				db,
				"SELECT match_kind || ':' || COALESCE(scheduled_date, 'null') FROM plan_transactions WHERE transaction_id = 'ledger-evidence'"
			)
		).toBe('evidence:null');
		expect(firstValue<number>(db, 'SELECT COUNT(*) FROM pragma_foreign_key_check')).toBe(0);
	});

	it('renames Repayments to Installment plan while preserving references', async () => {
		const db = await createTestDatabase();
		await applyMigrations(db, '0017_replace_subscriptions_with_repayments.sql');
		db.run("INSERT INTO accounts (id, name) VALUES ('account-installment', 'Main')");
		db.run(`INSERT INTO plans (
			id, account_id, category_id, direction, cadence, amount_cents, next_date
		) VALUES (
			'plan-installment', 'account-installment', 'cat-repayments', 'expense', 'monthly',
			10000, '2026-08-01'
		)`);

		applySql(db, await readFile(installmentPlanMigrationPath, 'utf8'));

		expect(
			firstValue<string>(
				db,
				"SELECT id || ':' || name FROM categories WHERE id = 'cat-installment-plan'"
			)
		).toBe('cat-installment-plan:Installment plan');
		expect(
			firstValue<number>(db, "SELECT COUNT(*) FROM categories WHERE id = 'cat-repayments'")
		).toBe(0);
		expect(
			firstValue<string>(db, "SELECT category_id FROM plans WHERE id = 'plan-installment'")
		).toBe('cat-installment-plan');
		expect(firstValue<number>(db, 'SELECT COUNT(*) FROM pragma_foreign_key_check')).toBe(0);
	});

	it('replaces Subscriptions with Repayments without misclassifying existing data', async () => {
		const db = await createTestDatabase();
		await applyMigrations(db, '0016_unify_plans.sql');
		db.run("INSERT INTO accounts (id, name) VALUES ('account-1', 'Main')");
		db.run(`INSERT INTO transactions (
			id, account_id, category_id, dedupe_key, booking_date, amount_cents,
			payee, search_text, classification_status
		) VALUES (
			'txn-1', 'account-1', 'cat-subscriptions', 'subscription-1', '2026-07-01', -1999,
			'Example subscription', 'example subscription', 'auto'
		)`);
		db.run(`INSERT INTO recurring_groups (
			id, account_id, category_id, payee, direction, cadence, expected_amount_cents
		) VALUES (
			'group-1', 'account-1', 'cat-subscriptions', 'Example subscription', 'outgoing',
			'monthly', 1999
		)`);
		db.run(`INSERT INTO plans (
			id, account_id, category_id, direction, cadence, amount_cents, next_date
		) VALUES (
			'plan-1', 'account-1', 'cat-subscriptions', 'expense', 'monthly', 1999, '2026-08-01'
		)`);

		applySql(db, await readFile(repaymentsCategoryMigrationPath, 'utf8'));

		expect(
			firstValue<number>(db, "SELECT COUNT(*) FROM categories WHERE id = 'cat-subscriptions'")
		).toBe(0);
		expect(
			firstValue<string>(
				db,
				"SELECT name || ':' || type || ':' || icon FROM categories WHERE id = 'cat-repayments'"
			)
		).toBe('Repayments:expense:hand-coins');
		expect(
			firstValue<number>(db, "SELECT COUNT(*) FROM category_rules WHERE id = 'rule-subscriptions'")
		).toBe(0);
		expect(
			firstValue<string>(
				db,
				"SELECT COALESCE(category_id, 'null') || ':' || classification_status FROM transactions WHERE id = 'txn-1'"
			)
		).toBe('null:unknown');
		expect(
			firstValue<string>(
				db,
				"SELECT reason || ':' || status FROM transaction_review_flags WHERE transaction_id = 'txn-1'"
			)
		).toBe('manual_review:open');
		expect(
			firstValue<number>(
				db,
				"SELECT COUNT(*) FROM recurring_groups WHERE id = 'group-1' AND category_id IS NULL AND needs_review = 1"
			)
		).toBe(1);
		expect(
			firstValue<number>(
				db,
				"SELECT COUNT(*) FROM plans WHERE id = 'plan-1' AND category_id IS NULL"
			)
		).toBe(1);
		expect(firstValue<number>(db, 'SELECT COUNT(*) FROM pragma_foreign_key_check')).toBe(0);
	});

	it('adds the editable Development expense category without duplicates', async () => {
		const db = await createTestDatabase();
		applySql(db, await readFile(initialMigrationPath, 'utf8'));
		applySql(db, await readFile(seedCategoriesMigrationPath, 'utf8'));
		const migration = await readFile(developmentCategoryMigrationPath, 'utf8');

		applySql(db, migration);
		applySql(db, migration);

		expect(
			firstValue<string>(
				db,
				"SELECT name || ':' || type || ':' || icon FROM categories WHERE id = 'cat-development'"
			)
		).toBe('Development:expense:code-2');
		expect(
			firstValue<number>(db, "SELECT COUNT(*) FROM categories WHERE id = 'cat-development'")
		).toBe(1);
	});

	it('adds the editable Vehicles expense category without duplicates', async () => {
		const db = await createTestDatabase();
		applySql(db, await readFile(initialMigrationPath, 'utf8'));
		applySql(db, await readFile(seedCategoriesMigrationPath, 'utf8'));
		const migration = await readFile(vehiclesCategoryMigrationPath, 'utf8');

		applySql(db, migration);
		applySql(db, migration);

		expect(
			firstValue<string>(
				db,
				"SELECT name || ':' || type || ':' || icon FROM categories WHERE id = 'cat-vehicles'"
			)
		).toBe('Vehicles:expense:car-front');
		expect(
			firstValue<number>(db, "SELECT COUNT(*) FROM categories WHERE id = 'cat-vehicles'")
		).toBe(1);
	});

	it('adds daily cadence while preserving recurring groups and contracts', async () => {
		const db = await createTestDatabase();
		for (const migration of [
			initialMigrationPath,
			subaccountMigrationPath,
			recurringV2MigrationPath,
			recurringLabelsMigrationPath,
			dkbCreditcardMigrationPath,
			dkbNamingMigrationPath,
			profileRemovalMigrationPath
		]) {
			applySql(db, await readFile(migration, 'utf8'));
		}
		db.run("INSERT INTO accounts (id, name) VALUES ('account-1', 'Main')");
		db.run(
			"INSERT INTO recurring_groups (id, account_id, payee, cadence, expected_amount_cents) VALUES ('group-1', 'account-1', 'Monthly Service', 'monthly', 1000)"
		);
		db.run(
			"INSERT INTO contracts (id, account_id, name, kind, cadence, expected_amount_cents, next_date) VALUES ('contract-1', 'account-1', 'Monthly Contract', 'subscription', 'monthly', 1000, '2026-08-01')"
		);

		applySql(db, await readFile(dailyCadenceMigrationPath, 'utf8'));
		applySql(db, await readFile(recurringEndDateMigrationPath, 'utf8'));
		db.run(
			"INSERT INTO recurring_groups (id, account_id, payee, cadence, expected_amount_cents) VALUES ('group-daily', 'account-1', 'Daily Service', 'daily', 100)"
		);
		db.run("UPDATE recurring_groups SET end_date = '2026-08-31' WHERE id = 'group-daily'");
		db.run(
			"INSERT INTO contracts (id, account_id, name, kind, cadence, expected_amount_cents, next_date) VALUES ('contract-daily', 'account-1', 'Daily Contract', 'subscription', 'daily', 100, '2026-08-01')"
		);

		expect(firstValue<number>(db, 'SELECT COUNT(*) FROM recurring_groups')).toBe(2);
		expect(
			firstValue<string>(db, "SELECT end_date FROM recurring_groups WHERE id = 'group-daily'")
		).toBe('2026-08-31');
		expect(firstValue<number>(db, 'SELECT COUNT(*) FROM contracts')).toBe(2);
		expect(firstValue<number>(db, 'SELECT COUNT(*) FROM pragma_foreign_key_check')).toBe(0);
	});

	it('adds the first occurrence suffix to existing DKB credit card fingerprints', async () => {
		const db = await createTestDatabase();
		applySql(db, await readFile(initialMigrationPath, 'utf8'));
		applySql(db, await readFile(subaccountMigrationPath, 'utf8'));
		applySql(db, await readFile(recurringV2MigrationPath, 'utf8'));
		applySql(db, await readFile(recurringLabelsMigrationPath, 'utf8'));
		applySql(db, await readFile(dkbCreditcardMigrationPath, 'utf8'));
		applySql(db, await readFile(dkbNamingMigrationPath, 'utf8'));
		applySql(db, await readFile(profileRemovalMigrationPath, 'utf8'));
		db.run("INSERT INTO accounts (id, name) VALUES ('account-1', 'Credit Card')");
		db.run(
			"INSERT INTO import_batches (id, account_id, file_hash, adapter_id) VALUES ('batch-1', 'account-1', 'hash-1', 'dkb_creditcard')"
		);
		db.run(
			"INSERT INTO transactions (id, account_id, import_batch_id, dedupe_key, booking_date, amount_cents, search_text) VALUES ('txn-1', 'account-1', 'batch-1', 'fp_12345678', '2026-03-23', -595, 'anthropic')"
		);

		applySql(db, await readFile(dkbCreditcardDeduplicationMigrationPath, 'utf8'));

		expect(firstValue<string>(db, "SELECT dedupe_key FROM transactions WHERE id = 'txn-1'")).toBe(
			'fp_12345678:1'
		);
	});

	it('expands legacy DKB references with posting details while preserving other keys', async () => {
		const db = await createTestDatabase();
		applySql(db, await readFile(initialMigrationPath, 'utf8'));
		applySql(db, await readFile(subaccountMigrationPath, 'utf8'));
		applySql(db, await readFile(recurringV2MigrationPath, 'utf8'));
		applySql(db, await readFile(recurringLabelsMigrationPath, 'utf8'));
		applySql(db, await readFile(dkbCreditcardMigrationPath, 'utf8'));
		applySql(db, await readFile(dkbNamingMigrationPath, 'utf8'));
		applySql(db, await readFile(profileRemovalMigrationPath, 'utf8'));
		db.run("INSERT INTO accounts (id, name) VALUES ('account-1', 'Main Giro')");
		db.run(
			"INSERT INTO import_batches (id, account_id, file_hash, adapter_id) VALUES ('dkb-batch', 'account-1', 'hash-1', 'dkb_girocard'), ('n26-batch', 'account-1', 'hash-2', 'n26')"
		);
		db.run(`INSERT INTO transactions (
			id, account_id, import_batch_id, dedupe_key, booking_date, value_date, amount_cents, search_text
		) VALUES
			('dkb-reference', 'account-1', 'dkb-batch', '1047796546992', '2026-01-26', '2026-01-26', -218, 'paypal'),
			('dkb-fingerprint', 'account-1', 'dkb-batch', 'fp_12345678', '2026-01-25', '2026-01-25', -100, 'shop'),
			('n26-reference', 'account-1', 'n26-batch', 'n26-id', '2026-01-24', '2026-01-24', -200, 'cafe')`);

		applySql(db, await readFile(dkbDeduplicationMigrationPath, 'utf8'));

		expect(
			firstValue<string>(db, "SELECT dedupe_key FROM transactions WHERE id = 'dkb-reference'")
		).toBe('dkb_ref:1047796546992|2026-01-26|2026-01-26|-218');
		expect(
			firstValue<string>(db, "SELECT dedupe_key FROM transactions WHERE id = 'dkb-fingerprint'")
		).toBe('fp_12345678');
		expect(
			firstValue<string>(db, "SELECT dedupe_key FROM transactions WHERE id = 'n26-reference'")
		).toBe('n26-id');
	});

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
