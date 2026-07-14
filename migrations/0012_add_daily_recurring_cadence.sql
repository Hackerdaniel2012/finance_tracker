PRAGMA foreign_keys = OFF;

CREATE TABLE recurring_groups_new (
	id TEXT PRIMARY KEY,
	account_id TEXT,
	category_id TEXT,
	label TEXT,
	payee TEXT NOT NULL,
	direction TEXT CHECK (direction IN ('incoming', 'outgoing')),
	canonical_payee_key TEXT NOT NULL DEFAULT '',
	cadence TEXT NOT NULL CHECK (cadence IN ('daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
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

INSERT INTO recurring_groups_new SELECT * FROM recurring_groups;
DROP TABLE recurring_groups;
ALTER TABLE recurring_groups_new RENAME TO recurring_groups;

CREATE TABLE contracts_new (
	id TEXT PRIMARY KEY,
	account_id TEXT,
	category_id TEXT,
	name TEXT NOT NULL,
	payee TEXT,
	kind TEXT NOT NULL CHECK (kind IN ('fixed_cost', 'subscription', 'salary', 'income', 'other')),
	cadence TEXT NOT NULL CHECK (cadence IN ('daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
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

INSERT INTO contracts_new SELECT * FROM contracts;
DROP TABLE contracts;
ALTER TABLE contracts_new RENAME TO contracts;

CREATE INDEX idx_recurring_groups_status_next_date ON recurring_groups (status, next_date);
CREATE INDEX idx_recurring_groups_detector_key
	ON recurring_groups (account_id, direction, cadence, canonical_payee_key, status);
CREATE INDEX idx_contracts_status_next_date ON contracts (status, next_date);

PRAGMA foreign_keys = ON;
