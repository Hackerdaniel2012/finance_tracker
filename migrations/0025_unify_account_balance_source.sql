ALTER TABLE import_batches ADD COLUMN reported_balance_cents INTEGER;
ALTER TABLE import_batches ADD COLUMN calculated_balance_cents INTEGER;

ALTER TABLE account_balance_snapshots
	ADD COLUMN anchor_import_batch_id TEXT REFERENCES import_batches (id) ON DELETE CASCADE;

CREATE UNIQUE INDEX idx_balance_snapshots_anchor_account
	ON account_balance_snapshots (account_id)
	WHERE anchor_import_batch_id IS NOT NULL;

-- Existing installations stored a manually entered current balance directly on the account.
-- Anchor that value to the first confirmed import so all later balances can use one algorithm.
INSERT INTO account_balance_snapshots (
	id,
	account_id,
	snapshot_date,
	balance_cents,
	source,
	anchor_import_batch_id
)
SELECT
	'balance-anchor:' || a.id,
	a.id,
	b.end_date,
	CASE
		WHEN a.current_balance_cents IS NOT NULL THEN a.current_balance_cents
		ELSE a.opening_balance_cents + COALESCE((
			SELECT SUM(t.amount_cents)
			FROM transactions t
			WHERE t.account_id = a.id
				AND t.booking_date <= b.end_date
		), 0)
	END,
	'imported',
	b.id
FROM accounts a
INNER JOIN import_batches b ON b.id = (
	SELECT first_batch.id
	FROM import_batches first_batch
	WHERE first_batch.account_id = a.id
		AND first_batch.end_date IS NOT NULL
	ORDER BY first_batch.created_at ASC, first_batch.id ASC
	LIMIT 1
)
WHERE NOT EXISTS (
	SELECT 1
	FROM account_balance_snapshots existing
	WHERE existing.account_id = a.id
);

UPDATE import_batches
SET reported_balance_cents = (
		SELECT s.balance_cents
		FROM account_balance_snapshots s
		WHERE s.anchor_import_batch_id = import_batches.id
	),
	calculated_balance_cents = NULL
WHERE id IN (
	SELECT anchor_import_batch_id
	FROM account_balance_snapshots
	WHERE anchor_import_batch_id IS NOT NULL
);
