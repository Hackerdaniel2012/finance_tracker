PRAGMA foreign_keys = OFF;

CREATE TABLE import_batches_new (
	id TEXT PRIMARY KEY,
	account_id TEXT NOT NULL,
	file_hash TEXT NOT NULL,
	adapter_id TEXT NOT NULL CHECK (adapter_id IN ('n26', 'trade_republic', 'dkb_girocard', 'dkb_creditcard')),
	start_date TEXT,
	end_date TEXT,
	row_count INTEGER NOT NULL DEFAULT 0,
	imported_count INTEGER NOT NULL DEFAULT 0,
	duplicate_count INTEGER NOT NULL DEFAULT 0,
	error_count INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE,
	UNIQUE (account_id, file_hash)
);

INSERT INTO import_batches_new (
	id, account_id, file_hash, adapter_id, start_date, end_date, row_count,
	imported_count, duplicate_count, error_count, created_at
)
SELECT
	b.id, p.account_id, b.file_hash, b.adapter_id, b.start_date, b.end_date, b.row_count,
	b.imported_count, b.duplicate_count, b.error_count, b.created_at
FROM import_batches b
INNER JOIN import_profiles p ON p.id = b.profile_id;

CREATE TABLE transactions_new (
	id TEXT PRIMARY KEY,
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
	subaccount TEXT,
	FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE,
	FOREIGN KEY (import_batch_id) REFERENCES import_batches_new (id) ON DELETE CASCADE,
	FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE SET NULL,
	UNIQUE (account_id, dedupe_key)
);

INSERT INTO transactions_new (
	id, account_id, import_batch_id, category_id, dedupe_key, booking_date, value_date,
	amount_cents, currency, original_amount_cents, original_currency, exchange_rate,
	balance_after_cents, payee, description, note, search_text, classification_status,
	created_at, updated_at, subaccount
)
SELECT
	id, account_id, import_batch_id, category_id, dedupe_key, booking_date, value_date,
	amount_cents, currency, original_amount_cents, original_currency, exchange_rate,
	balance_after_cents, payee, description, note, search_text, classification_status,
	created_at, updated_at, subaccount
FROM transactions;

CREATE TABLE import_row_errors_new (
	id TEXT PRIMARY KEY,
	import_batch_id TEXT NOT NULL,
	row_number INTEGER NOT NULL,
	code TEXT NOT NULL,
	message TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (import_batch_id) REFERENCES import_batches_new (id) ON DELETE CASCADE
);

INSERT INTO import_row_errors_new (id, import_batch_id, row_number, code, message, created_at)
SELECT id, import_batch_id, row_number, code, message, created_at
FROM import_row_errors
WHERE import_batch_id IS NOT NULL;

CREATE TABLE recurring_groups_new (
	id TEXT PRIMARY KEY,
	account_id TEXT,
	category_id TEXT,
	label TEXT,
	payee TEXT NOT NULL,
	direction TEXT CHECK (direction IN ('incoming', 'outgoing')),
	canonical_payee_key TEXT NOT NULL DEFAULT '',
	cadence TEXT NOT NULL CHECK (cadence IN ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
	expected_amount_cents INTEGER NOT NULL,
	next_date TEXT,
	status TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested', 'confirmed', 'ignored')),
	confidence INTEGER NOT NULL DEFAULT 0,
	source TEXT NOT NULL DEFAULT 'imported' CHECK (source IN ('manual', 'imported', 'confirmed_suggestion')),
	needs_review INTEGER NOT NULL DEFAULT 0 CHECK (needs_review IN (0, 1)),
	detector_version INTEGER NOT NULL DEFAULT 1,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE,
	FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE SET NULL
);

INSERT INTO recurring_groups_new (
	id, account_id, category_id, label, payee, direction, canonical_payee_key, cadence,
	expected_amount_cents, next_date, status, confidence, source, needs_review, detector_version,
	created_at, updated_at
)
SELECT
	r.id, COALESCE(r.account_id, p.account_id), r.category_id, r.label, r.payee, r.direction,
	r.canonical_payee_key, r.cadence, r.expected_amount_cents, r.next_date, r.status,
	r.confidence, r.source, r.needs_review, r.detector_version, r.created_at, r.updated_at
FROM recurring_groups r
LEFT JOIN import_profiles p ON p.id = r.profile_id;

CREATE TABLE contracts_new (
	id TEXT PRIMARY KEY,
	account_id TEXT,
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
	FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE SET NULL
);

INSERT INTO contracts_new (
	id, account_id, category_id, name, payee, kind, cadence, expected_amount_cents, next_date,
	end_date, status, source, created_at, updated_at
)
SELECT
	c.id, COALESCE(c.account_id, p.account_id), c.category_id, c.name, c.payee, c.kind, c.cadence,
	c.expected_amount_cents, c.next_date, c.end_date, c.status, c.source, c.created_at, c.updated_at
FROM contracts c
LEFT JOIN import_profiles p ON p.id = c.profile_id;

CREATE TABLE transaction_tags_new (
	transaction_id TEXT NOT NULL,
	tag_id TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (transaction_id, tag_id),
	FOREIGN KEY (transaction_id) REFERENCES transactions_new (id) ON DELETE CASCADE,
	FOREIGN KEY (tag_id) REFERENCES tags (id) ON DELETE CASCADE
);

INSERT INTO transaction_tags_new (transaction_id, tag_id, created_at)
SELECT transaction_id, tag_id, created_at FROM transaction_tags;

CREATE TABLE recurring_group_transactions_new (
	recurring_group_id TEXT NOT NULL,
	transaction_id TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (recurring_group_id, transaction_id),
	FOREIGN KEY (recurring_group_id) REFERENCES recurring_groups_new (id) ON DELETE CASCADE,
	FOREIGN KEY (transaction_id) REFERENCES transactions_new (id) ON DELETE CASCADE
);

INSERT INTO recurring_group_transactions_new (recurring_group_id, transaction_id, created_at)
SELECT recurring_group_id, transaction_id, created_at FROM recurring_group_transactions;

CREATE TABLE transaction_review_flags_new (
	id TEXT PRIMARY KEY,
	transaction_id TEXT NOT NULL UNIQUE,
	reason TEXT NOT NULL CHECK (reason IN ('unknown_category', 'parse_warning', 'manual_review')),
	status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'ignored')),
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	resolved_at TEXT,
	FOREIGN KEY (transaction_id) REFERENCES transactions_new (id) ON DELETE CASCADE
);

INSERT INTO transaction_review_flags_new (
	id, transaction_id, reason, status, created_at, resolved_at
)
SELECT id, transaction_id, reason, status, created_at, resolved_at
FROM transaction_review_flags;

DROP TABLE transaction_review_flags;
DROP TABLE transaction_tags;
DROP TABLE recurring_group_transactions;
DROP TABLE import_row_errors;
DROP TABLE transactions;
DROP TABLE import_batches;
DROP TABLE recurring_groups;
DROP TABLE contracts;
DROP TABLE import_profiles;

ALTER TABLE recurring_groups_new RENAME TO recurring_groups;
ALTER TABLE contracts_new RENAME TO contracts;
ALTER TABLE import_batches_new RENAME TO import_batches;
ALTER TABLE transactions_new RENAME TO transactions;
ALTER TABLE import_row_errors_new RENAME TO import_row_errors;
ALTER TABLE transaction_tags_new RENAME TO transaction_tags;
ALTER TABLE recurring_group_transactions_new RENAME TO recurring_group_transactions;
ALTER TABLE transaction_review_flags_new RENAME TO transaction_review_flags;

CREATE INDEX idx_import_batches_account_created ON import_batches (account_id, created_at);
CREATE INDEX idx_transactions_account_date ON transactions (account_id, booking_date DESC);
CREATE INDEX idx_transactions_account_subaccount ON transactions (account_id, subaccount);
CREATE INDEX idx_transactions_category_date ON transactions (category_id, booking_date DESC);
CREATE INDEX idx_transactions_review_status ON transactions (classification_status, booking_date DESC);
CREATE INDEX idx_transactions_search_text ON transactions (search_text);
CREATE INDEX idx_recurring_groups_status_next_date ON recurring_groups (status, next_date);
CREATE INDEX idx_recurring_groups_detector_key
	ON recurring_groups (account_id, direction, cadence, canonical_payee_key, status);
CREATE INDEX idx_contracts_status_next_date ON contracts (status, next_date);
CREATE INDEX idx_import_row_errors_batch ON import_row_errors (import_batch_id, row_number);
CREATE INDEX idx_review_flags_status ON transaction_review_flags (status, created_at);

PRAGMA foreign_keys = ON;
