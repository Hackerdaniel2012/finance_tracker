INSERT OR IGNORE INTO categories (
	id, name, type, color, icon, is_default, sort_order
) VALUES (
	'cat-shopping', 'Shopping', 'expense', '#d97706', 'shopping-bag', 1, 45
);

INSERT OR IGNORE INTO category_rules (
	id, category_id, name, field, operator, pattern, priority, is_global
) VALUES (
	'rule-amazon-prime-shopping', 'cat-shopping', 'Amazon Prime shopping membership',
	'description', 'regex', '\b(amznprime|amazon prime)\b', 32, 1
);

UPDATE transactions
SET
	category_id = 'cat-shopping',
	classification_status = 'auto',
	updated_at = CURRENT_TIMESTAMP
WHERE classification_status IN ('unknown', 'auto')
	AND (
		LOWER(COALESCE(description, '')) LIKE '%amznprime%'
		OR LOWER(COALESCE(description, '')) LIKE '%amazon prime%'
	);

UPDATE transaction_review_flags
SET
	status = 'resolved',
	resolved_at = CURRENT_TIMESTAMP
WHERE status = 'open'
	AND transaction_id IN (
		SELECT id
		FROM transactions
		WHERE category_id = 'cat-shopping'
			AND classification_status = 'auto'
			AND (
				LOWER(COALESCE(description, '')) LIKE '%amznprime%'
				OR LOWER(COALESCE(description, '')) LIKE '%amazon prime%'
			)
	);

UPDATE recurring_groups
SET
	category_id = 'cat-shopping',
	needs_review = 0,
	updated_at = CURRENT_TIMESTAMP
WHERE status = 'suggested'
	AND EXISTS (
		SELECT 1
		FROM recurring_group_transactions rgt
		INNER JOIN transactions t ON t.id = rgt.transaction_id
		WHERE rgt.recurring_group_id = recurring_groups.id
			AND (
				LOWER(COALESCE(t.description, '')) LIKE '%amznprime%'
				OR LOWER(COALESCE(t.description, '')) LIKE '%amazon prime%'
			)
	);
