PRAGMA foreign_keys = OFF;

CREATE TABLE import_profiles_new (
	id TEXT PRIMARY KEY,
	account_id TEXT NOT NULL UNIQUE,
	bank_id TEXT NOT NULL CHECK (bank_id IN ('n26', 'trade_republic', 'dkb_girocard', 'dkb_creditcard')),
	status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
);

INSERT INTO import_profiles_new (id, account_id, bank_id, status, created_at, updated_at)
SELECT id, account_id,
	CASE WHEN bank_id = 'dkb' THEN 'dkb_girocard' ELSE bank_id END,
	status, created_at, updated_at
FROM import_profiles;

DROP TABLE import_profiles;
ALTER TABLE import_profiles_new RENAME TO import_profiles;

CREATE TABLE import_batches_new (
	id TEXT PRIMARY KEY,
	profile_id TEXT NOT NULL,
	file_hash TEXT NOT NULL,
	adapter_id TEXT NOT NULL CHECK (adapter_id IN ('n26', 'trade_republic', 'dkb_girocard', 'dkb_creditcard')),
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

INSERT INTO import_batches_new (
	id, profile_id, file_hash, adapter_id, start_date, end_date, row_count,
	imported_count, duplicate_count, error_count, created_at
)
SELECT id, profile_id, file_hash,
	CASE WHEN adapter_id = 'dkb' THEN 'dkb_girocard' ELSE adapter_id END,
	start_date, end_date, row_count, imported_count, duplicate_count, error_count, created_at
FROM import_batches;

DROP TABLE import_batches;
ALTER TABLE import_batches_new RENAME TO import_batches;

PRAGMA foreign_keys = ON;
