-- 0016 matched confirmed recurring groups to contracts too broadly. Preserve only true duplicates.
INSERT INTO plans (
	id, account_id, category_id, label, counterparty, direction, cadence, amount_cents,
	next_date, end_date, status, source, source_recurring_group_id, note,
	schedule_anchor_date, schedule_occurrence_index, manual_status
)
SELECT
	'recurring-repair:' || rg.id, rg.account_id, rg.category_id, rg.label, rg.payee,
	CASE rg.direction WHEN 'incoming' THEN 'income' ELSE 'expense' END,
	rg.cadence, rg.expected_amount_cents, rg.next_date, rg.end_date, 'active',
	'recurring_suggestion', rg.id, NULL, rg.next_date, 0, 'active'
FROM recurring_groups rg
JOIN plans p ON p.id = rg.plan_id
WHERE rg.status = 'confirmed'
	AND rg.direction IS NOT NULL
	AND rg.next_date IS NOT NULL
	AND p.source_recurring_group_id IS NULL
	AND NOT (
		p.account_id IS rg.account_id
		AND p.category_id IS rg.category_id
		AND p.label IS rg.label
		AND p.counterparty IS rg.payee
		AND p.direction = CASE rg.direction WHEN 'incoming' THEN 'income' ELSE 'expense' END
		AND p.cadence = rg.cadence
		AND p.amount_cents = rg.expected_amount_cents
		AND p.next_date = rg.next_date
		AND p.end_date IS rg.end_date
		AND p.status = 'active'
	);

UPDATE recurring_groups
SET plan_id = 'recurring-repair:' || id,
	updated_at = CURRENT_TIMESTAMP
WHERE id IN (SELECT source_recurring_group_id FROM plans WHERE id LIKE 'recurring-repair:%');

-- The group evidence belongs to the restored plan, not the formerly shared contract.
UPDATE plan_transactions
SET plan_id = 'recurring-repair:' || (
	SELECT rgt.recurring_group_id
	FROM recurring_group_transactions rgt
	WHERE rgt.transaction_id = plan_transactions.transaction_id
		AND 'recurring-repair:' || rgt.recurring_group_id IN (SELECT id FROM plans)
	LIMIT 1
)
WHERE transaction_id IN (
	SELECT rgt.transaction_id FROM recurring_group_transactions rgt
	WHERE 'recurring-repair:' || rgt.recurring_group_id IN (SELECT id FROM plans)
);
