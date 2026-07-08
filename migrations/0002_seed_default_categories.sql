INSERT OR IGNORE INTO categories (
	id, name, type, color, icon, is_default, sort_order
) VALUES
	('cat-income', 'Income', 'income', '#16a34a', 'arrow-down-left', 1, 10),
	('cat-salary', 'Salary', 'income', '#059669', 'briefcase-business', 1, 20),
	('cat-housing', 'Housing', 'expense', '#dc2626', 'house', 1, 30),
	('cat-groceries', 'Groceries', 'expense', '#ea580c', 'shopping-basket', 1, 40),
	('cat-transport', 'Transport', 'expense', '#2563eb', 'car', 1, 50),
	('cat-utilities', 'Utilities', 'expense', '#7c3aed', 'plug', 1, 60),
	('cat-health', 'Health', 'expense', '#db2777', 'heart-pulse', 1, 70),
	('cat-leisure', 'Leisure', 'expense', '#0891b2', 'ticket', 1, 80),
	('cat-transfer', 'Transfer', 'transfer', '#52525b', 'repeat-2', 1, 90),
	('cat-investments', 'Investments', 'investment', '#4f46e5', 'line-chart', 1, 100),
	('cat-unknown', 'Unknown', 'unknown', '#71717a', 'circle-help', 1, 999);
