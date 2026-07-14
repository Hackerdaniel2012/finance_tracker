INSERT OR IGNORE INTO categories (
	id, name, type, color, icon, is_default, sort_order, created_at, updated_at
)
SELECT
	'cat-installment-plan', 'Installment plan', type, color, icon, is_default, sort_order,
	created_at, CURRENT_TIMESTAMP
FROM categories
WHERE id = 'cat-repayments';

UPDATE transactions
SET category_id = 'cat-installment-plan',
	updated_at = CURRENT_TIMESTAMP
WHERE category_id = 'cat-repayments';

UPDATE recurring_groups
SET category_id = 'cat-installment-plan',
	updated_at = CURRENT_TIMESTAMP
WHERE category_id = 'cat-repayments';

UPDATE plans
SET category_id = 'cat-installment-plan',
	updated_at = CURRENT_TIMESTAMP
WHERE category_id = 'cat-repayments';

UPDATE category_rules
SET category_id = 'cat-installment-plan',
	updated_at = CURRENT_TIMESTAMP
WHERE category_id = 'cat-repayments';

DELETE FROM categories
WHERE id = 'cat-repayments';
