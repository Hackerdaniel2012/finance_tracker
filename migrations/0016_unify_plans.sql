PRAGMA foreign_keys = OFF;

CREATE TABLE plans (
	id TEXT PRIMARY KEY,
	account_id TEXT,
	category_id TEXT,
	label TEXT,
	counterparty TEXT,
	direction TEXT NOT NULL CHECK (direction IN ('expense', 'income')),
	cadence TEXT NOT NULL CHECK (cadence IN ('once', 'daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'yearly')),
	amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
	next_date TEXT NOT NULL,
	end_date TEXT,
	status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'done', 'cancelled')),
	source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'migrated', 'recurring_suggestion')),
	source_recurring_group_id TEXT UNIQUE,
	note TEXT,
	created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE SET NULL,
	FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE SET NULL,
	FOREIGN KEY (source_recurring_group_id) REFERENCES recurring_groups (id) ON DELETE SET NULL,
	CHECK ((cadence = 'once' AND end_date IS NULL) OR cadence != 'once')
);

CREATE TABLE plan_transactions (
	plan_id TEXT NOT NULL,
	transaction_id TEXT NOT NULL UNIQUE,
	matched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	PRIMARY KEY (plan_id, transaction_id),
	FOREIGN KEY (plan_id) REFERENCES plans (id) ON DELETE CASCADE,
	FOREIGN KEY (transaction_id) REFERENCES transactions (id) ON DELETE CASCADE
);

INSERT INTO plans (
	id, account_id, category_id, label, counterparty, direction, cadence, amount_cents,
	next_date, end_date, status, source, note, created_at, updated_at
)
SELECT
	'contract:' || id, account_id, category_id, name, COALESCE(payee, name),
	CASE WHEN kind IN ('salary', 'income') THEN 'income' ELSE 'expense' END,
	cadence, expected_amount_cents, next_date, end_date,
	CASE status WHEN 'active' THEN 'active' WHEN 'paused' THEN 'paused' ELSE 'done' END,
	CASE WHEN source = 'manual' THEN 'manual' ELSE 'migrated' END,
	NULL, created_at, updated_at
FROM contracts;

INSERT INTO plans (
	id, account_id, category_id, label, counterparty, direction, cadence, amount_cents,
	next_date, end_date, status, source, note, created_at, updated_at
)
SELECT
	'planned-payment:' || id, account_id, category_id, payee, payee, 'expense', 'once', amount_cents,
	due_date, NULL,
	CASE status WHEN 'planned' THEN 'active' WHEN 'paid' THEN 'done' ELSE 'cancelled' END,
	'migrated', note, created_at, updated_at
FROM planned_payments;

INSERT INTO plans (
	id, account_id, category_id, label, counterparty, direction, cadence, amount_cents,
	next_date, end_date, status, source, note, created_at, updated_at
)
SELECT
	'planned-income:' || id, account_id, category_id, payer, payer, 'income', 'once', amount_cents,
	due_date, NULL,
	CASE status WHEN 'planned' THEN 'active' WHEN 'received' THEN 'done' ELSE 'cancelled' END,
	'migrated', note, created_at, updated_at
FROM planned_income;

INSERT INTO plans (
	id, account_id, category_id, label, counterparty, direction, cadence, amount_cents,
	next_date, end_date, status, source, source_recurring_group_id, note, created_at, updated_at
)
SELECT
	'recurring:' || r.id, r.account_id, r.category_id, r.label, r.payee,
	CASE r.direction WHEN 'incoming' THEN 'income' ELSE 'expense' END,
	r.cadence, r.expected_amount_cents, r.next_date, r.end_date, 'active',
	'recurring_suggestion', r.id, NULL, r.created_at, r.updated_at
FROM recurring_groups r
WHERE r.status = 'confirmed'
	AND r.direction IS NOT NULL
	AND r.next_date IS NOT NULL
	AND NOT EXISTS (
		SELECT 1 FROM plans p
		WHERE p.account_id IS r.account_id
			AND p.category_id IS r.category_id
			AND p.counterparty = r.payee
			AND p.direction = CASE r.direction WHEN 'incoming' THEN 'income' ELSE 'expense' END
			AND p.cadence = r.cadence
			AND p.amount_cents = r.expected_amount_cents
			AND p.next_date = r.next_date
	);

ALTER TABLE recurring_groups ADD COLUMN plan_id TEXT REFERENCES plans(id) ON DELETE SET NULL;

UPDATE recurring_groups
SET plan_id = COALESCE(
	(SELECT id FROM plans WHERE source_recurring_group_id = recurring_groups.id),
	(SELECT p.id FROM plans p WHERE p.account_id IS recurring_groups.account_id
		AND p.category_id IS recurring_groups.category_id AND p.counterparty = recurring_groups.payee
		AND p.direction = CASE recurring_groups.direction WHEN 'incoming' THEN 'income' ELSE 'expense' END
		AND p.cadence = recurring_groups.cadence AND p.amount_cents = recurring_groups.expected_amount_cents
		AND p.next_date = recurring_groups.next_date LIMIT 1)
)
WHERE status = 'confirmed';

INSERT OR IGNORE INTO plan_transactions (plan_id, transaction_id)
SELECT rg.plan_id, rgt.transaction_id
FROM recurring_groups rg
INNER JOIN recurring_group_transactions rgt ON rgt.recurring_group_id = rg.id
WHERE rg.plan_id IS NOT NULL;

CREATE INDEX idx_plans_active_schedule ON plans (status, direction, next_date);
CREATE INDEX idx_plan_transactions_plan ON plan_transactions (plan_id);

DROP TABLE contracts;
DROP TABLE planned_payments;
DROP TABLE planned_income;

PRAGMA foreign_keys = ON;
