INSERT OR IGNORE INTO categories (
	id, name, type, color, icon, is_default, sort_order
) VALUES (
	'cat-telecommunications', 'Telecommunications', 'expense', '#0284c7', 'smartphone', 1, 62
);

UPDATE category_rules
SET
	category_id = 'cat-telecommunications',
	name = 'Telecommunications providers',
	updated_at = CURRENT_TIMESTAMP
WHERE id = 'rule-telecom';

UPDATE transactions
SET
	category_id = 'cat-telecommunications',
	updated_at = CURRENT_TIMESTAMP
WHERE category_id = 'cat-utilities'
	AND classification_status = 'auto'
	AND (
		LOWER(COALESCE(payee, '')) LIKE '%vodafone%'
		OR LOWER(COALESCE(payee, '')) LIKE '%telekom deutschland%'
		OR LOWER(COALESCE(payee, '')) LIKE '%freenet dls%'
		OR LOWER(COALESCE(payee, '')) LIKE '%klarmobil%'
		OR LOWER(COALESCE(payee, '')) LIKE '%congstar%'
		OR LOWER(TRIM(COALESCE(payee, ''))) = 'o2'
		OR LOWER(COALESCE(payee, '')) LIKE 'o2 %'
	);

UPDATE recurring_groups
SET
	category_id = 'cat-telecommunications',
	updated_at = CURRENT_TIMESTAMP
WHERE category_id = 'cat-utilities'
	AND status = 'suggested'
	AND (
		LOWER(payee) LIKE '%vodafone%'
		OR LOWER(payee) LIKE '%telekom deutschland%'
		OR LOWER(payee) LIKE '%freenet dls%'
		OR LOWER(payee) LIKE '%klarmobil%'
		OR LOWER(payee) LIKE '%congstar%'
		OR LOWER(TRIM(payee)) = 'o2'
		OR LOWER(payee) LIKE 'o2 %'
	);
