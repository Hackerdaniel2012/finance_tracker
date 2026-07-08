PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS accounts (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	institution TEXT,
	currency TEXT NOT NULL DEFAULT 'EUR',
	opening_balance_cents INTEGER NOT NULL DEFAULT 0,
	current_balance_cents INTEGER,
	display_order INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS import_profiles (
	id TEXT PRIMARY KEY,
	account_id TEXT NOT NULL UNIQUE,
	bank_id TEXT NOT NULL CHECK (bank_id IN ('n26', 'trade_republic', 'dkb')),
	label TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS categories (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	type TEXT NOT NULL CHECK (type IN ('income', 'expense', 'transfer', 'investment', 'unknown')),
	color TEXT,
	icon TEXT,
	is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
	sort_order INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS category_rules (
	id TEXT PRIMARY KEY,
	category_id TEXT NOT NULL,
	name TEXT NOT NULL,
	field TEXT NOT NULL CHECK (field IN ('payee', 'description', 'note', 'search_text')),
	operator TEXT NOT NULL CHECK (operator IN ('contains', 'equals', 'starts_with', 'regex')),
	pattern TEXT NOT NULL,
	priority INTEGER NOT NULL DEFAULT 100,
	is_global INTEGER NOT NULL DEFAULT 1 CHECK (is_global IN (0, 1)),
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS import_batches (
	id TEXT PRIMARY KEY,
	profile_id TEXT NOT NULL,
	file_hash TEXT NOT NULL,
	adapter_id TEXT NOT NULL CHECK (adapter_id IN ('n26', 'trade_republic', 'dkb')),
	start_date TEXT,
	end_date TEXT,
	row_count INTEGER NOT NULL DEFAULT 0,
	imported_count INTEGER NOT NULL DEFAULT 0,
	duplicate_count INTEGER NOT NULL DEFAULT 0,
	error_count INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (profile_id) REFERENCES import_profiles (id) ON DELETE CASCADE,
	UNIQUE (profile_id, file_hash)
);

CREATE TABLE IF NOT EXISTS transactions (
	id TEXT PRIMARY KEY,
	profile_id TEXT NOT NULL,
	account_id TEXT NOT NULL,
	import_batch_id TEXT,
	category_id TEXT,
	dedupe_key TEXT NOT NULL,
	booking_date TEXT NOT NULL,
	value_date TEXT,
	amount_cents INTEGER NOT NULL,
	currency TEXT NOT NULL DEFAULT 'EUR',
	original_amount_cents INTEGER,
	original_currency TEXT,
	exchange_rate TEXT,
	balance_after_cents INTEGER,
	payee TEXT,
	description TEXT,
	note TEXT,
	search_text TEXT NOT NULL DEFAULT '',
	classification_status TEXT NOT NULL DEFAULT 'unknown' CHECK (
		classification_status IN ('unknown', 'auto', 'manual', 'ignored')
	),
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (profile_id) REFERENCES import_profiles (id) ON DELETE CASCADE,
	FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE,
	FOREIGN KEY (import_batch_id) REFERENCES import_batches (id) ON DELETE CASCADE,
	FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE SET NULL,
	UNIQUE (profile_id, dedupe_key)
);

CREATE TABLE IF NOT EXISTS tags (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL UNIQUE,
	color TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transaction_tags (
	transaction_id TEXT NOT NULL,
	tag_id TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (transaction_id, tag_id),
	FOREIGN KEY (transaction_id) REFERENCES transactions (id) ON DELETE CASCADE,
	FOREIGN KEY (tag_id) REFERENCES tags (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS recurring_groups (
	id TEXT PRIMARY KEY,
	account_id TEXT,
	profile_id TEXT,
	category_id TEXT,
	payee TEXT NOT NULL,
	cadence TEXT NOT NULL CHECK (cadence IN ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
	expected_amount_cents INTEGER NOT NULL,
	next_date TEXT,
	status TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested', 'confirmed', 'ignored')),
	confidence INTEGER NOT NULL DEFAULT 0,
	source TEXT NOT NULL DEFAULT 'imported' CHECK (source IN ('manual', 'imported', 'confirmed_suggestion')),
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE,
	FOREIGN KEY (profile_id) REFERENCES import_profiles (id) ON DELETE CASCADE,
	FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS recurring_group_transactions (
	recurring_group_id TEXT NOT NULL,
	transaction_id TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (recurring_group_id, transaction_id),
	FOREIGN KEY (recurring_group_id) REFERENCES recurring_groups (id) ON DELETE CASCADE,
	FOREIGN KEY (transaction_id) REFERENCES transactions (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS contracts (
	id TEXT PRIMARY KEY,
	account_id TEXT,
	profile_id TEXT,
	category_id TEXT,
	name TEXT NOT NULL,
	payee TEXT,
	kind TEXT NOT NULL CHECK (kind IN ('fixed_cost', 'subscription', 'salary', 'income', 'other')),
	cadence TEXT NOT NULL CHECK (cadence IN ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
	expected_amount_cents INTEGER NOT NULL,
	next_date TEXT NOT NULL,
	end_date TEXT,
	status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
	source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'imported', 'confirmed_recurring')),
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE SET NULL,
	FOREIGN KEY (profile_id) REFERENCES import_profiles (id) ON DELETE SET NULL,
	FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS planned_payments (
	id TEXT PRIMARY KEY,
	account_id TEXT,
	category_id TEXT,
	payee TEXT NOT NULL,
	amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
	due_date TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'paid', 'cancelled')),
	note TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE SET NULL,
	FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS planned_income (
	id TEXT PRIMARY KEY,
	account_id TEXT,
	category_id TEXT,
	payer TEXT NOT NULL,
	amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
	due_date TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'received', 'cancelled')),
	note TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE SET NULL,
	FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS account_balance_snapshots (
	id TEXT PRIMARY KEY,
	account_id TEXT NOT NULL,
	snapshot_date TEXT NOT NULL,
	balance_cents INTEGER NOT NULL,
	source TEXT NOT NULL CHECK (source IN ('imported', 'manual', 'computed')),
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE,
	UNIQUE (account_id, snapshot_date, source)
);

CREATE TABLE IF NOT EXISTS marked_liabilities (
	id TEXT PRIMARY KEY,
	account_id TEXT,
	name TEXT NOT NULL,
	amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
	as_of_date TEXT NOT NULL,
	status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cleared')),
	note TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS transaction_review_flags (
	id TEXT PRIMARY KEY,
	transaction_id TEXT NOT NULL UNIQUE,
	reason TEXT NOT NULL CHECK (reason IN ('unknown_category', 'parse_warning', 'manual_review')),
	status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'ignored')),
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	resolved_at TEXT,
	FOREIGN KEY (transaction_id) REFERENCES transactions (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS import_row_errors (
	id TEXT PRIMARY KEY,
	import_batch_id TEXT,
	profile_id TEXT NOT NULL,
	row_number INTEGER NOT NULL,
	code TEXT NOT NULL,
	message TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (import_batch_id) REFERENCES import_batches (id) ON DELETE CASCADE,
	FOREIGN KEY (profile_id) REFERENCES import_profiles (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_import_profiles_bank_id ON import_profiles (bank_id);
CREATE INDEX IF NOT EXISTS idx_category_rules_priority ON category_rules (priority, created_at);
CREATE INDEX IF NOT EXISTS idx_import_batches_profile_created ON import_batches (profile_id, created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_account_date ON transactions (account_id, booking_date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_profile_date ON transactions (profile_id, booking_date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_category_date ON transactions (category_id, booking_date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_review_status ON transactions (classification_status, booking_date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_search_text ON transactions (search_text);
CREATE INDEX IF NOT EXISTS idx_recurring_groups_status_next_date ON recurring_groups (status, next_date);
CREATE INDEX IF NOT EXISTS idx_contracts_status_next_date ON contracts (status, next_date);
CREATE INDEX IF NOT EXISTS idx_planned_payments_due_date ON planned_payments (due_date, status);
CREATE INDEX IF NOT EXISTS idx_planned_income_due_date ON planned_income (due_date, status);
CREATE INDEX IF NOT EXISTS idx_balance_snapshots_account_date ON account_balance_snapshots (account_id, snapshot_date);
CREATE INDEX IF NOT EXISTS idx_marked_liabilities_status_date ON marked_liabilities (status, as_of_date);
CREATE INDEX IF NOT EXISTS idx_review_flags_status ON transaction_review_flags (status, created_at);
CREATE INDEX IF NOT EXISTS idx_import_row_errors_batch ON import_row_errors (import_batch_id, row_number);
