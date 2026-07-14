PRAGMA foreign_keys = OFF;

CREATE TABLE marked_liabilities_new (
	id TEXT PRIMARY KEY,
	account_id TEXT,
	name TEXT NOT NULL,
	amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
	as_of_date TEXT NOT NULL,
	annual_interest_rate_bps INTEGER CHECK (
		annual_interest_rate_bps IS NULL OR annual_interest_rate_bps >= 0
	),
	status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cleared')),
	note TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE SET NULL
);

INSERT INTO marked_liabilities_new (
	id, account_id, name, amount_cents, as_of_date, annual_interest_rate_bps,
	status, note, created_at, updated_at
)
SELECT
	id, account_id, name, amount_cents, as_of_date, NULL,
	status, note, created_at, updated_at
FROM marked_liabilities;

DROP TABLE marked_liabilities;
ALTER TABLE marked_liabilities_new RENAME TO marked_liabilities;

ALTER TABLE plans
	ADD COLUMN liability_id TEXT REFERENCES marked_liabilities(id) ON DELETE SET NULL;

CREATE INDEX idx_plans_liability ON plans (liability_id);

PRAGMA foreign_keys = ON;
