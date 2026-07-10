ALTER TABLE recurring_groups
	ADD COLUMN direction TEXT CHECK (direction IN ('incoming', 'outgoing'));

ALTER TABLE recurring_groups
	ADD COLUMN canonical_payee_key TEXT NOT NULL DEFAULT '';

ALTER TABLE recurring_groups
	ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 0 CHECK (needs_review IN (0, 1));

ALTER TABLE recurring_groups
	ADD COLUMN detector_version INTEGER NOT NULL DEFAULT 1;

UPDATE recurring_groups
SET canonical_payee_key = LOWER(TRIM(payee));

UPDATE recurring_groups
SET direction = (
	SELECT CASE
		WHEN MIN(t.amount_cents) > 0 THEN 'incoming'
		WHEN MAX(t.amount_cents) < 0 THEN 'outgoing'
		ELSE NULL
	END
	FROM recurring_group_transactions rgt
	INNER JOIN transactions t ON t.id = rgt.transaction_id
	WHERE rgt.recurring_group_id = recurring_groups.id
);

UPDATE recurring_groups
SET needs_review = 1
WHERE status = 'confirmed'
	AND (direction IS NULL OR category_id IS NULL);

DELETE FROM recurring_groups WHERE status = 'suggested';

CREATE INDEX IF NOT EXISTS idx_recurring_groups_detector_key
	ON recurring_groups (account_id, direction, cadence, canonical_payee_key, status);
