CREATE TABLE liability_balance_baselines (
	liability_id TEXT PRIMARY KEY REFERENCES marked_liabilities(id) ON DELETE CASCADE,
	amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
	as_of_date TEXT NOT NULL,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The first automatic snapshot is the state before any matched payment; otherwise current data is authoritative.
INSERT INTO liability_balance_baselines (liability_id, amount_cents, as_of_date)
SELECT
	l.id,
	COALESCE((
		SELECT pt.liability_amount_before FROM plan_transactions pt
		WHERE pt.liability_id = l.id AND pt.match_kind = 'automatic'
			AND pt.liability_amount_before IS NOT NULL
		ORDER BY pt.occurrence_index, pt.transaction_id LIMIT 1
	), l.amount_cents),
	COALESCE((
		SELECT pt.liability_as_of_date_before FROM plan_transactions pt
		WHERE pt.liability_id = l.id AND pt.match_kind = 'automatic'
			AND pt.liability_as_of_date_before IS NOT NULL
		ORDER BY pt.occurrence_index, pt.transaction_id LIMIT 1
	), l.as_of_date)
FROM marked_liabilities l;
