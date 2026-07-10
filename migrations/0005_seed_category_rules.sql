INSERT OR IGNORE INTO categories (
	id, name, type, color, icon, is_default, sort_order
) VALUES
	('cat-subscriptions', 'Subscriptions', 'expense', '#0891b2', 'calendar-check', 1, 85),
	('cat-banking-fees', 'Bank Fees', 'expense', '#52525b', 'landmark', 1, 95);

INSERT OR IGNORE INTO category_rules (
	id, category_id, name, field, operator, pattern, priority, is_global
) VALUES
	('rule-salary', 'cat-salary', 'Salary / payroll', 'search_text', 'regex', '\b(biontech se|lohn|gehalt)\b', 10, 1),
	('rule-housing', 'cat-housing', 'Rent / housing', 'search_text', 'regex', '\b(miete|kaution|wohnheimsiedl)\b', 15, 1),
	('rule-investments', 'cat-investments', 'Trade Republic trading', 'description', 'regex', '\b(trading buy|trading sell|dividend)\b', 20, 1),
	('rule-transfer-own-account', 'cat-transfer', 'Own-account transfers', 'payee', 'regex', '^(tagesgeldkonto|hauptkonto|nicht berühren)$', 25, 1),
	('rule-transfer-tr-cash', 'cat-transfer', 'Trade Republic cash movements', 'description', 'regex', '\bcash (transfer|customer_inbound|customer_outbound)\b', 25, 1),
	('rule-groceries', 'cat-groceries', 'Supermarkets & drugstores', 'payee', 'regex', '\b(rewe|lidl|netto|aldi|edeka|kaufland|penny|dm-drogerie markt)\b', 30, 1),
	('rule-transport-fuel', 'cat-transport', 'Fuel stations', 'payee', 'regex', '\b(jet\.tankstelle|jet-tankstelle|allguth|esso station|aral station|shell|total)\b', 35, 1),
	('rule-transport-public', 'cat-transport', 'Public transport & parking', 'search_text', 'regex', '\b(db vertrieb|deutsche bahn|logpay|mvv|vbrb)\b', 35, 1),
	('rule-telecom', 'cat-utilities', 'Telecom providers', 'payee', 'regex', '\b(vodafone|telekom deutschland|freenet dls|klarmobil|o2|congstar)\b', 40, 1),
	('rule-health-insurance', 'cat-health', 'Health insurance', 'payee', 'regex', '\b(barmenia|barmer|allianz private krankenv)\b', 45, 1),
	('rule-health-fitness', 'cat-health', 'Gym & fitness', 'payee', 'regex', '\b(fit star|gym|mcfit|clever fit)\b', 45, 1),
	('rule-subscriptions', 'cat-subscriptions', 'Digital subscriptions', 'payee', 'regex', '\b(apple\.com/bill|aws emea|google\*youtube|chatgpt subscription|netflix|spotify|disney)\b', 50, 1),
	('rule-banking-fees', 'cat-banking-fees', 'Banking & ATM fees', 'description', 'regex', '\b(n26 fee|atm withdrawal fee|cash26)\b', 55, 1);
