-- Repair the generated anchors from migration 0025 before changing legacy
-- import batches. Stored current balances describe the migration date, not the
-- end date of the first historical import.
UPDATE import_batches
SET reported_balance_cents = NULL
WHERE id IN (
	SELECT s.anchor_import_batch_id
	FROM account_balance_snapshots s
	INNER JOIN accounts a ON a.id = s.account_id
	WHERE s.id = 'balance-anchor:' || a.id
		AND a.current_balance_cents IS NOT NULL
		AND s.anchor_import_batch_id IS NOT NULL
);

UPDATE account_balance_snapshots
SET
	snapshot_date = date('now'),
	balance_cents = (
		SELECT a.current_balance_cents
		FROM accounts a
		WHERE a.id = account_balance_snapshots.account_id
	),
	source = 'manual',
	anchor_import_batch_id = NULL
WHERE id = 'balance-anchor:' || account_id
	AND EXISTS (
		SELECT 1
		FROM accounts a
		WHERE a.id = account_balance_snapshots.account_id
			AND a.current_balance_cents IS NOT NULL
	);

ALTER TABLE transactions RENAME COLUMN subaccount TO source_account_key;

DROP INDEX IF EXISTS idx_transactions_account_subaccount;
CREATE INDEX idx_transactions_account_source_key
	ON transactions (account_id, source_account_key);

CREATE TABLE import_runs (
	id TEXT PRIMARY KEY,
	file_hash TEXT NOT NULL,
	adapter_id TEXT NOT NULL CHECK (adapter_id IN ('dkb_girocard', 'dkb_creditcard', 'n26', 'trade_republic')),
	start_date TEXT,
	end_date TEXT,
	row_count INTEGER NOT NULL DEFAULT 0,
	imported_count INTEGER NOT NULL DEFAULT 0,
	duplicate_count INTEGER NOT NULL DEFAULT 0,
	error_count INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	import_order INTEGER
);

ALTER TABLE import_batches
	ADD COLUMN import_run_id TEXT REFERENCES import_runs (id) ON DELETE CASCADE;
ALTER TABLE import_batches ADD COLUMN source_account_key TEXT;

-- Keep one run per historical upload. Equal file hashes can represent separate
-- uploads to different legacy accounts, so they must not be merged.
INSERT INTO import_runs (
	id, file_hash, adapter_id, start_date, end_date, row_count,
	imported_count, duplicate_count, error_count, created_at, import_order
)
SELECT
	'legacy-run:' || b.id,
	b.file_hash,
	b.adapter_id,
	b.start_date,
	b.end_date,
	b.row_count,
	b.imported_count,
	b.duplicate_count,
	b.error_count,
	b.created_at,
	ROW_NUMBER() OVER (ORDER BY b.created_at ASC, b.rowid ASC)
FROM import_batches b;

UPDATE import_batches
SET import_run_id = 'legacy-run:' || id;

CREATE INDEX idx_import_batches_run ON import_batches (import_run_id);
CREATE UNIQUE INDEX idx_import_batches_run_account
	ON import_batches (import_run_id, account_id);
CREATE INDEX idx_import_runs_created ON import_runs (created_at);
CREATE UNIQUE INDEX idx_import_runs_order ON import_runs (import_order);

CREATE TABLE import_run_order_sequence (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	last_order INTEGER NOT NULL CHECK (last_order >= 0)
);

INSERT INTO import_run_order_sequence (id, last_order)
SELECT 1, COALESCE(MAX(import_order), 0)
FROM import_runs;

-- Allocate later orders from a persistent high-water mark so deleting the
-- newest run never makes its order available again.
CREATE TRIGGER assign_import_run_order
AFTER INSERT ON import_runs
WHEN NEW.import_order IS NULL
BEGIN
	UPDATE import_run_order_sequence
	SET last_order = last_order + 1
	WHERE id = 1;

	UPDATE import_runs
	SET import_order = (
		SELECT last_order FROM import_run_order_sequence WHERE id = 1
	)
	WHERE id = NEW.id;
END;

CREATE TRIGGER track_explicit_import_run_order
AFTER INSERT ON import_runs
WHEN NEW.import_order IS NOT NULL
BEGIN
	UPDATE import_run_order_sequence
	SET last_order = MAX(last_order, NEW.import_order)
	WHERE id = 1;
END;

CREATE TABLE import_account_mappings (
	adapter_id TEXT NOT NULL CHECK (adapter_id IN ('dkb_girocard', 'dkb_creditcard', 'n26', 'trade_republic')),
	source_account_key TEXT NOT NULL,
	account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (adapter_id, source_account_key)
);

CREATE INDEX idx_import_account_mappings_account
	ON import_account_mappings (account_id);

-- Preserve a trustworthy balance for legacy accounts that were never imported.
-- Empty zero-euro accounts intentionally remain uninitialised.
INSERT INTO account_balance_snapshots (
	id, account_id, snapshot_date, balance_cents, source
)
SELECT
	'legacy-preserved:' || a.id,
	a.id,
	date('now'),
	COALESCE(
		a.current_balance_cents,
		a.opening_balance_cents + COALESCE((
			SELECT SUM(t.amount_cents)
			FROM transactions t
			WHERE t.account_id = a.id
				AND t.booking_date <= date('now')
		), 0)
	),
	'manual'
FROM accounts a
WHERE NOT EXISTS (
		SELECT 1 FROM account_balance_snapshots s WHERE s.account_id = a.id
	)
	AND NOT EXISTS (
		SELECT 1 FROM import_batches b WHERE b.account_id = a.id
	)
	AND (
		a.current_balance_cents IS NOT NULL
		OR a.opening_balance_cents <> 0
		OR EXISTS (SELECT 1 FROM transactions t WHERE t.account_id = a.id)
	);

-- Materialise the legacy multi-account split so every following statement uses
-- exactly the same parent/key/account mapping.
CREATE TABLE migration_0026_account_split AS
WITH split_parents AS (
	SELECT account_id
	FROM transactions
	WHERE source_account_key IS NOT NULL AND trim(source_account_key) <> ''
	GROUP BY account_id
	HAVING COUNT(DISTINCT source_account_key) > 1
)
SELECT DISTINCT
	a.id AS old_account_id,
	t.source_account_key,
	'legacy-source-account:' || a.id || ':' || hex(t.source_account_key) AS new_account_id
FROM accounts a
INNER JOIN split_parents p ON p.account_id = a.id
INNER JOIN transactions t ON t.account_id = a.id
WHERE t.source_account_key IS NOT NULL AND trim(t.source_account_key) <> '';

INSERT INTO accounts (
	id, name, institution, currency, opening_balance_cents,
	current_balance_cents, display_order, created_at, updated_at
)
SELECT
	s.new_account_id,
	a.name || ' – ' || s.source_account_key,
	a.institution,
	a.currency,
	0,
	NULL,
	(SELECT COALESCE(MAX(display_order), 0) FROM accounts) +
		ROW_NUMBER() OVER (ORDER BY s.old_account_id, s.source_account_key),
	a.created_at,
	CURRENT_TIMESTAMP
FROM migration_0026_account_split s
INNER JOIN accounts a ON a.id = s.old_account_id;

CREATE TABLE migration_0026_original_batches AS
SELECT b.*
FROM import_batches b
WHERE EXISTS (
	SELECT 1 FROM migration_0026_account_split s WHERE s.old_account_id = b.account_id
);

INSERT INTO import_batches (
	id, account_id, file_hash, adapter_id, start_date, end_date,
	row_count, imported_count, duplicate_count, error_count,
	reported_balance_cents, calculated_balance_cents, created_at,
	import_run_id, source_account_key
)
SELECT
	'legacy-source-batch:' || b.id || ':' || hex(s.source_account_key),
	s.new_account_id,
	b.file_hash,
	b.adapter_id,
	MIN(t.booking_date),
	MAX(t.booking_date),
	COUNT(*),
	COUNT(*),
	0,
	0,
	NULL,
	NULL,
	b.created_at,
	b.import_run_id,
	s.source_account_key
FROM migration_0026_original_batches b
INNER JOIN migration_0026_account_split s ON s.old_account_id = b.account_id
INNER JOIN transactions t
	ON t.import_batch_id = b.id AND t.source_account_key = s.source_account_key
GROUP BY b.id, s.source_account_key;

UPDATE transactions
SET
	account_id = (
		SELECT s.new_account_id
		FROM migration_0026_account_split s
		WHERE s.old_account_id = transactions.account_id
			AND s.source_account_key = transactions.source_account_key
	),
	import_batch_id = CASE
		WHEN import_batch_id IS NULL THEN NULL
		ELSE 'legacy-source-batch:' || import_batch_id || ':' || hex(source_account_key)
	END
WHERE EXISTS (
	SELECT 1
	FROM migration_0026_account_split s
	WHERE s.old_account_id = transactions.account_id
		AND s.source_account_key = transactions.source_account_key
);

-- The old anchor represented the combined container and must not initialise any
-- split account. Plans, liabilities and keyless transactions remain on it.
DELETE FROM account_balance_snapshots
WHERE account_id IN (SELECT DISTINCT old_account_id FROM migration_0026_account_split);

-- Parse errors have no source-account key. Attach them to one surviving split
-- batch when possible before removing an empty legacy container batch.
UPDATE import_row_errors
SET import_batch_id = (
	SELECT MIN(split_batch.id)
	FROM import_batches split_batch
	INNER JOIN migration_0026_original_batches original
		ON original.import_run_id = split_batch.import_run_id
	WHERE original.id = import_row_errors.import_batch_id
		AND split_batch.id LIKE 'legacy-source-batch:%'
)
WHERE import_batch_id IN (SELECT id FROM migration_0026_original_batches)
	AND EXISTS (
		SELECT 1
		FROM import_batches split_batch
		INNER JOIN migration_0026_original_batches original
			ON original.import_run_id = split_batch.import_run_id
		WHERE original.id = import_row_errors.import_batch_id
			AND split_batch.id LIKE 'legacy-source-batch:%'
	);

-- Keep the original batch as a real container for keyless rows. This avoids any
-- temporary orphan and is safe under D1's always-on foreign-key cascades.
UPDATE import_batches
SET
	start_date = (
		SELECT MIN(t.booking_date) FROM transactions t WHERE t.import_batch_id = import_batches.id
	),
	end_date = (
		SELECT MAX(t.booking_date) FROM transactions t WHERE t.import_batch_id = import_batches.id
	),
	row_count = (
		SELECT COUNT(*) FROM transactions t WHERE t.import_batch_id = import_batches.id
	),
	imported_count = (
		SELECT COUNT(*) FROM transactions t WHERE t.import_batch_id = import_batches.id
	),
	duplicate_count = 0,
	error_count = 0,
	reported_balance_cents = NULL,
	calculated_balance_cents = NULL,
	source_account_key = NULL
WHERE id IN (SELECT id FROM migration_0026_original_batches)
	AND EXISTS (
		SELECT 1 FROM transactions t WHERE t.import_batch_id = import_batches.id
	);

-- Fully split batches have no remaining transaction, snapshot or error
-- references and can now be deleted without triggering data loss.
DELETE FROM import_batches
WHERE id IN (SELECT id FROM migration_0026_original_batches)
	AND EXISTS (
		SELECT 1 FROM import_batches split_batch
		WHERE split_batch.import_run_id = import_batches.import_run_id
			AND split_batch.id LIKE 'legacy-source-batch:%'
	)
	AND NOT EXISTS (
		SELECT 1 FROM transactions t WHERE t.import_batch_id = import_batches.id
	);

INSERT OR IGNORE INTO import_account_mappings (
	adapter_id, source_account_key, account_id
)
SELECT DISTINCT b.adapter_id, b.source_account_key, b.account_id
FROM import_batches b
WHERE b.source_account_key IS NOT NULL;

DROP TABLE migration_0026_original_batches;
DROP TABLE migration_0026_account_split;

-- Claims make new file imports atomic while retaining every historical upload.
CREATE TABLE import_file_claims (
	adapter_id TEXT NOT NULL CHECK (adapter_id IN ('dkb_girocard', 'dkb_creditcard', 'n26', 'trade_republic')),
	file_hash TEXT NOT NULL,
	import_run_id TEXT NOT NULL UNIQUE REFERENCES import_runs (id) ON DELETE CASCADE,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (adapter_id, file_hash)
);

INSERT INTO import_file_claims (adapter_id, file_hash, import_run_id, created_at)
SELECT r.adapter_id, r.file_hash, r.id, r.created_at
FROM import_runs r
WHERE r.import_order = (
	SELECT MAX(candidate.import_order)
	FROM import_runs candidate
	WHERE candidate.adapter_id = r.adapter_id
		AND candidate.file_hash = r.file_hash
);

PRAGMA foreign_key_check;
