INSERT OR IGNORE INTO categories (
	id, name, type, color, icon, is_default, sort_order
) VALUES (
	'cat-repayments', 'Repayments', 'expense', '#b45309', 'hand-coins', 1, 86
);

DELETE FROM category_rules
WHERE category_id = 'cat-subscriptions';

INSERT INTO transaction_review_flags (
	id, transaction_id, reason, status, resolved_at
)
SELECT
	'review-retired-subscriptions-' || t.id,
	t.id,
	'manual_review',
	'open',
	NULL
FROM transactions t
WHERE t.category_id = 'cat-subscriptions'
ON CONFLICT(transaction_id) DO UPDATE SET
	reason = 'manual_review',
	status = 'open',
	resolved_at = NULL;

UPDATE transactions
SET category_id = NULL,
	classification_status = 'unknown',
	updated_at = CURRENT_TIMESTAMP
WHERE category_id = 'cat-subscriptions';

UPDATE recurring_groups
SET category_id = NULL,
	needs_review = 1,
	updated_at = CURRENT_TIMESTAMP
WHERE category_id = 'cat-subscriptions';

UPDATE plans
SET category_id = NULL,
	updated_at = CURRENT_TIMESTAMP
WHERE category_id = 'cat-subscriptions';

DELETE FROM categories
WHERE id = 'cat-subscriptions';
