ALTER TABLE plans ADD COLUMN schedule_anchor_date TEXT;
ALTER TABLE plans ADD COLUMN schedule_occurrence_index INTEGER NOT NULL DEFAULT 0 CHECK (schedule_occurrence_index >= 0);
ALTER TABLE plans ADD COLUMN manual_status TEXT CHECK (manual_status IN ('active', 'paused', 'done', 'cancelled'));

UPDATE plans
SET schedule_anchor_date = next_date,
	manual_status = status;

ALTER TABLE plan_transactions ADD COLUMN match_kind TEXT NOT NULL DEFAULT 'evidence'
	CHECK (match_kind IN ('evidence', 'automatic'));
ALTER TABLE plan_transactions ADD COLUMN scheduled_date TEXT;
ALTER TABLE plan_transactions ADD COLUMN occurrence_index INTEGER CHECK (occurrence_index IS NULL OR occurrence_index >= 0);
ALTER TABLE plan_transactions ADD COLUMN plan_next_date_before TEXT;
ALTER TABLE plan_transactions ADD COLUMN plan_occurrence_index_before INTEGER;
ALTER TABLE plan_transactions ADD COLUMN plan_status_before TEXT
	CHECK (plan_status_before IS NULL OR plan_status_before IN ('active', 'paused', 'done', 'cancelled'));
ALTER TABLE plan_transactions ADD COLUMN liability_id TEXT REFERENCES marked_liabilities(id) ON DELETE SET NULL;
ALTER TABLE plan_transactions ADD COLUMN liability_amount_before INTEGER;
ALTER TABLE plan_transactions ADD COLUMN liability_as_of_date_before TEXT;
ALTER TABLE plan_transactions ADD COLUMN liability_status_before TEXT
	CHECK (liability_status_before IS NULL OR liability_status_before IN ('active', 'cleared'));
ALTER TABLE plan_transactions ADD COLUMN interest_cents INTEGER;
ALTER TABLE plan_transactions ADD COLUMN principal_cents INTEGER;

CREATE UNIQUE INDEX idx_plan_transactions_occurrence
	ON plan_transactions (plan_id, occurrence_index)
	WHERE match_kind = 'automatic';
CREATE INDEX idx_plan_transactions_kind_schedule
	ON plan_transactions (plan_id, match_kind, scheduled_date);
CREATE UNIQUE INDEX idx_plans_unique_liability
	ON plans (liability_id)
	WHERE liability_id IS NOT NULL;
