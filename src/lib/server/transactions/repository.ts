import { NotFoundError, ValidationError } from '../accounts/errors';
import { matchesCategoryRule } from '../categories/matcher';
import type { DbClient, DbRow, DbValue } from '../db-client';
import type {
	Transaction,
	TransactionClassificationStatus,
	TransactionListFilters,
	TransactionListResult,
	TransactionSort,
	TransactionTag,
	TransactionUpdateResult,
	UpdateTransactionInput
} from './types';

const sortColumns: Record<TransactionSort, string> = {
	booking_date: 't.booking_date',
	amount_cents: 't.amount_cents',
	payee: 't.payee'
};

export async function listTransactions(
	db: DbClient,
	filters: TransactionListFilters
): Promise<TransactionListResult> {
	const { whereSql, values } = buildTransactionWhere(filters);
	const sortColumn = sortColumns[filters.sort];
	const direction = filters.direction.toUpperCase();
	const { results } = await db
		.prepare(
			`${baseTransactionSelect()}
			${whereSql}
			ORDER BY ${sortColumn} ${direction}, t.id DESC
			LIMIT ? OFFSET ?`
		)
		.bind(...values, filters.limit, filters.offset)
		.all<TransactionRow>();
	const total = await countTransactions(db, whereSql, values);

	return {
		transactions: await hydrateTransactions(db, results),
		pagination: {
			limit: filters.limit,
			offset: filters.offset,
			total
		}
	};
}

export async function listUnknownTransactions(
	db: DbClient,
	filters: TransactionListFilters
): Promise<TransactionListResult> {
	return listTransactions(db, { ...filters, status: 'unknown' });
}

export async function updateTransaction(
	db: DbClient,
	input: UpdateTransactionInput
): Promise<TransactionUpdateResult> {
	const existing = await getTransaction(db, input.id);
	if (!existing) {
		throw new NotFoundError('Transaction not found');
	}

	if (input.categoryId !== undefined && input.categoryId !== null) {
		await assertCategoryExists(db, input.categoryId);
	}

	await db
		.prepare(
			`UPDATE transactions
			SET
				category_id = ?,
				note = ?,
				classification_status = ?,
				updated_at = CURRENT_TIMESTAMP
			WHERE id = ?`
		)
		.bind(
			input.categoryId === undefined ? existing.categoryId : input.categoryId,
			input.note === undefined ? existing.note : input.note,
			input.categoryId !== undefined ? 'manual' : existing.classificationStatus,
			input.id
		)
		.run();

	if (input.tagNames !== undefined) {
		await replaceTransactionTags(db, input.id, input.tagNames);
	}

	if (input.categoryId) {
		await resolveReviewFlag(db, input.id);
	}

	let bulkAppliedCount = 0;
	if (input.createRule === true) {
		const categoryId = input.categoryId ?? existing.categoryId;
		if (!categoryId) {
			throw new ValidationError('categoryId is required to create a category rule');
		}
		bulkAppliedCount = await createRuleFromTransaction(db, {
			transactionId: input.id,
			categoryId,
			ruleName: input.ruleName,
			applyToExisting: input.applyRuleToExisting === true
		});
	}

	const updated = await getTransaction(db, input.id);
	if (!updated) {
		throw new NotFoundError('Transaction not found');
	}

	return { ...updated, classifiedCount: 1, bulkAppliedCount };
}

async function getTransaction(db: DbClient, id: string): Promise<Transaction | null> {
	const row = await db
		.prepare(`${baseTransactionSelect()} WHERE t.id = ?`)
		.bind(id)
		.first<TransactionRow>();

	if (!row) {
		return null;
	}

	const [transaction] = await hydrateTransactions(db, [row]);
	return transaction ?? null;
}

function baseTransactionSelect(): string {
	return `SELECT
		t.id,
		t.profile_id,
		t.account_id,
		a.name AS account_name,
		t.import_batch_id,
		t.category_id,
		c.name AS category_name,
		t.dedupe_key,
		t.booking_date,
		t.value_date,
		t.amount_cents,
		t.currency,
		t.original_amount_cents,
		t.original_currency,
		t.exchange_rate,
		t.balance_after_cents,
		t.payee,
		t.description,
		t.note,
		t.search_text,
		t.classification_status,
		r.id AS review_flag_id,
		r.reason AS review_reason,
		r.status AS review_status,
		t.created_at,
		t.updated_at
	FROM transactions t
	INNER JOIN accounts a ON a.id = t.account_id
	LEFT JOIN categories c ON c.id = t.category_id
	LEFT JOIN transaction_review_flags r ON r.transaction_id = t.id AND r.status = 'open'`;
}

function buildTransactionWhere(filters: TransactionListFilters): {
	whereSql: string;
	values: DbValue[];
} {
	const clauses: string[] = [];
	const values: DbValue[] = [];

	if (filters.accountId) {
		clauses.push('t.account_id = ?');
		values.push(filters.accountId);
	}

	if (filters.subaccount) {
		clauses.push('t.subaccount = ?');
		values.push(filters.subaccount);
	}

	if (filters.profileId) {
		clauses.push('t.profile_id = ?');
		values.push(filters.profileId);
	}

	if (filters.categoryId) {
		clauses.push('t.category_id = ?');
		values.push(filters.categoryId);
	}

	if (filters.status) {
		clauses.push('t.classification_status = ?');
		values.push(filters.status);
	}

	if (filters.transactionDirection === 'income') {
		clauses.push('t.amount_cents > 0');
	}

	if (filters.transactionDirection === 'expense') {
		clauses.push('t.amount_cents < 0');
	}

	if (filters.minAmountCents !== undefined) {
		clauses.push('t.amount_cents >= ?');
		values.push(filters.minAmountCents);
	}

	if (filters.maxAmountCents !== undefined) {
		clauses.push('t.amount_cents <= ?');
		values.push(filters.maxAmountCents);
	}

	if (filters.tag) {
		clauses.push(
			`EXISTS (
				SELECT 1
				FROM transaction_tags filter_tt
				INNER JOIN tags filter_tags ON filter_tags.id = filter_tt.tag_id
				WHERE filter_tt.transaction_id = t.id
					AND (filter_tags.id = ? OR filter_tags.name = ?)
			)`
		);
		values.push(filters.tag, filters.tag);
	}

	if (filters.from) {
		clauses.push('t.booking_date >= ?');
		values.push(filters.from);
	}

	if (filters.to) {
		clauses.push('t.booking_date <= ?');
		values.push(filters.to);
	}

	if (filters.search) {
		clauses.push(
			'(t.search_text LIKE ? OR t.payee LIKE ? OR t.description LIKE ? OR t.note LIKE ?)'
		);
		const pattern = `%${escapeLike(filters.search)}%`;
		values.push(pattern, pattern, pattern, pattern);
	}

	return {
		whereSql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
		values
	};
}

async function countTransactions(
	db: DbClient,
	whereSql: string,
	values: DbValue[]
): Promise<number> {
	const row = await db
		.prepare(
			`SELECT COUNT(*) AS count
			FROM transactions t
			${whereSql}`
		)
		.bind(...values)
		.first<CountRow>();

	return Number(row?.count ?? 0);
}

async function hydrateTransactions(db: DbClient, rows: TransactionRow[]): Promise<Transaction[]> {
	const tagsByTransactionId = await listTagsForTransactions(
		db,
		rows.map((row) => row.id)
	);

	return rows.map((row) => mapTransaction(row, tagsByTransactionId.get(row.id) ?? []));
}

async function listTagsForTransactions(
	db: DbClient,
	transactionIds: string[]
): Promise<Map<string, TransactionTag[]>> {
	const uniqueIds = [...new Set(transactionIds)];
	const tagsByTransactionId = new Map<string, TransactionTag[]>();
	if (uniqueIds.length === 0) {
		return tagsByTransactionId;
	}

	const placeholders = uniqueIds.map(() => '?').join(', ');
	const { results } = await db
		.prepare(
			`SELECT tt.transaction_id, tags.id, tags.name, tags.color
			FROM transaction_tags tt
			INNER JOIN tags ON tags.id = tt.tag_id
			WHERE tt.transaction_id IN (${placeholders})
			ORDER BY tags.name ASC`
		)
		.bind(...uniqueIds)
		.all<TagRow>();

	for (const row of results) {
		const existing = tagsByTransactionId.get(row.transaction_id) ?? [];
		existing.push({ id: row.id, name: row.name, color: row.color });
		tagsByTransactionId.set(row.transaction_id, existing);
	}

	return tagsByTransactionId;
}

async function replaceTransactionTags(
	db: DbClient,
	transactionId: string,
	tagNames: string[]
): Promise<void> {
	await db
		.prepare('DELETE FROM transaction_tags WHERE transaction_id = ?')
		.bind(transactionId)
		.run();

	for (const tagName of tagNames) {
		const tag = await getOrCreateTag(db, tagName);
		await db
			.prepare(
				`INSERT INTO transaction_tags (transaction_id, tag_id)
				VALUES (?, ?)`
			)
			.bind(transactionId, tag.id)
			.run();
	}
}

async function getOrCreateTag(db: DbClient, name: string): Promise<TransactionTag> {
	const existing = await db
		.prepare('SELECT id, name, color FROM tags WHERE name = ?')
		.bind(name)
		.first<TagOnlyRow>();
	if (existing) {
		return { id: existing.id, name: existing.name, color: existing.color };
	}

	const id = crypto.randomUUID();
	await db.prepare('INSERT INTO tags (id, name) VALUES (?, ?)').bind(id, name).run();

	return { id, name, color: null };
}

async function resolveReviewFlag(db: DbClient, transactionId: string): Promise<void> {
	await db
		.prepare(
			`UPDATE transaction_review_flags
			SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP
			WHERE transaction_id = ?
				AND status = 'open'`
		)
		.bind(transactionId)
		.run();
}

async function createRuleFromTransaction(
	db: DbClient,
	input: { transactionId: string; categoryId: string; ruleName?: string; applyToExisting: boolean }
): Promise<number> {
	const row = await db
		.prepare('SELECT payee, search_text FROM transactions WHERE id = ?')
		.bind(input.transactionId)
		.first<RuleSourceRow>();
	const pattern = row?.payee?.trim() || row?.search_text?.trim();
	if (!pattern) {
		throw new ValidationError('Transaction needs payee or search text to create a category rule');
	}

	await db
		.prepare(
			`INSERT INTO category_rules (id, category_id, name, field, operator, pattern, priority, is_global)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			crypto.randomUUID(),
			input.categoryId,
			input.ruleName ?? `Match ${pattern}`,
			row?.payee?.trim() ? 'payee' : 'search_text',
			'contains',
			pattern,
			100,
			1
		)
		.run();

	if (!input.applyToExisting) return 0;
	return applyRuleToUnknownTransactions(db, {
		field: row?.payee?.trim() ? 'payee' : 'search_text',
		operator: 'contains',
		pattern,
		categoryId: input.categoryId,
		excludeId: input.transactionId
	});
}

export async function previewCategoryRule(
	db: DbClient,
	rule: RuleMatchDraft
): Promise<{ matchCount: number; sample: RulePreviewRow[] }> {
	const rows = await listUnknownRuleRows(db);
	const matches = rows.filter((row) => matchesCategoryRule(mapRuleSource(row), rule));
	return {
		matchCount: matches.length,
		sample: matches.slice(0, 5).map((row) => ({
			id: row.id,
			bookingDate: row.booking_date,
			payee: row.payee,
			amountCents: row.amount_cents
		}))
	};
}

export async function reclassifyTransactions(db: DbClient): Promise<{
	updatedCount: number;
	matchedCount: number;
	unmatchedCount: number;
}> {
	const [{ results: rules }, { results: rows }] = await Promise.all([
		db
			.prepare(
				`SELECT id, category_id, field, operator, pattern, priority
				FROM category_rules
				ORDER BY priority ASC, created_at ASC`
			)
			.all<CategoryRuleRow>(),
		db
			.prepare(
				`SELECT id, payee, description, note, search_text, category_id, classification_status
				FROM transactions
				WHERE classification_status IN ('unknown', 'auto')
				ORDER BY booking_date DESC, id DESC`
			)
			.all<ReclassifyRow>()
	]);

	const sortedRules = rules.map((rule) => ({
		categoryId: rule.category_id,
		field: rule.field,
		operator: rule.operator,
		pattern: rule.pattern
	}));

	const toCategorize: { row: ReclassifyRow; newCategoryId: string }[] = [];
	const toUncategorize: ReclassifyRow[] = [];

	for (const row of rows) {
		const match = sortedRules.find((rule) => matchesCategoryRule(mapRuleSource(row), rule));
		const newCategoryId = match?.categoryId ?? null;
		const isMatched = newCategoryId !== null;

		if (row.category_id === newCategoryId && (isMatched || row.classification_status === 'unknown')) {
			continue;
		}

		if (isMatched && newCategoryId) {
			toCategorize.push({ row, newCategoryId });
		} else {
			toUncategorize.push(row);
		}
	}

	for (let offset = 0; offset < toCategorize.length; offset += 200) {
		const statements = toCategorize.slice(offset, offset + 200).flatMap(({ row, newCategoryId }) => [
			db
				.prepare(
					`UPDATE transactions
					SET category_id = ?, classification_status = 'auto', updated_at = CURRENT_TIMESTAMP
					WHERE id = ?`
				)
				.bind(newCategoryId, row.id),
			db
				.prepare(
					`UPDATE transaction_review_flags
					SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP
					WHERE transaction_id = ? AND status = 'open'`
				)
				.bind(row.id)
		]);
		if (db.batch) await db.batch(statements);
		else for (const statement of statements) await statement.run();
	}

	for (let offset = 0; offset < toUncategorize.length; offset += 200) {
		const statements = toUncategorize.slice(offset, offset + 200).flatMap((row) => [
			db
				.prepare(
					`UPDATE transactions
					SET category_id = NULL, classification_status = 'unknown', updated_at = CURRENT_TIMESTAMP
					WHERE id = ?`
				)
				.bind(row.id),
			db
				.prepare(
					`INSERT OR IGNORE INTO transaction_review_flags (id, transaction_id, reason)
					VALUES (?, ?, 'unknown_category')`
				)
				.bind(crypto.randomUUID(), row.id)
		]);
		if (db.batch) await db.batch(statements);
		else for (const statement of statements) await statement.run();
	}

	return {
		updatedCount: toCategorize.length + toUncategorize.length,
		matchedCount: toCategorize.length,
		unmatchedCount: toUncategorize.length
	};
}

async function applyRuleToUnknownTransactions(
	db: DbClient,
	rule: RuleMatchDraft & { categoryId: string; excludeId: string }
): Promise<number> {
	const rows = (await listUnknownRuleRows(db)).filter(
		(row) => row.id !== rule.excludeId && matchesCategoryRule(mapRuleSource(row), rule)
	);
	for (let offset = 0; offset < rows.length; offset += 200) {
		const statements = rows.slice(offset, offset + 200).flatMap((row) => [
			db
				.prepare(
					`UPDATE transactions
				SET category_id = ?, classification_status = 'auto', updated_at = CURRENT_TIMESTAMP
				WHERE id = ? AND classification_status = 'unknown'`
				)
				.bind(rule.categoryId, row.id),
			db
				.prepare(
					`UPDATE transaction_review_flags
				SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP
				WHERE transaction_id = ? AND status = 'open'`
				)
				.bind(row.id)
		]);
		if (db.batch) await db.batch(statements);
		else for (const statement of statements) await statement.run();
	}
	return rows.length;
}

async function listUnknownRuleRows(db: DbClient): Promise<RuleMatchRow[]> {
	const { results } = await db
		.prepare(
			`SELECT id, booking_date, amount_cents, payee, description, note, search_text
		FROM transactions
		WHERE classification_status = 'unknown'
		ORDER BY booking_date DESC, id DESC`
		)
		.all<RuleMatchRow>();
	return results;
}

function mapRuleSource(row: {
	payee: string | null;
	description: string | null;
	note: string | null;
	search_text: string;
}) {
	return {
		payee: row.payee,
		description: row.description,
		note: row.note,
		searchText: row.search_text
	};
}

async function assertCategoryExists(db: DbClient, categoryId: string): Promise<void> {
	const row = await db
		.prepare('SELECT id FROM categories WHERE id = ?')
		.bind(categoryId)
		.first<IdRow>();
	if (!row) {
		throw new NotFoundError('Category not found');
	}
}

function mapTransaction(row: TransactionRow, tags: TransactionTag[]): Transaction {
	return {
		id: row.id,
		profileId: row.profile_id,
		accountId: row.account_id,
		accountName: row.account_name,
		importBatchId: row.import_batch_id,
		categoryId: row.category_id,
		categoryName: row.category_name,
		dedupeKey: row.dedupe_key,
		bookingDate: row.booking_date,
		valueDate: row.value_date,
		amountCents: row.amount_cents,
		currency: row.currency,
		originalAmountCents: row.original_amount_cents,
		originalCurrency: row.original_currency,
		exchangeRate: row.exchange_rate,
		balanceAfterCents: row.balance_after_cents,
		payee: row.payee,
		description: row.description,
		note: row.note,
		searchText: row.search_text,
		classificationStatus: row.classification_status,
		tags,
		reviewFlag:
			row.review_flag_id && row.review_reason && row.review_status
				? {
						id: row.review_flag_id,
						reason: row.review_reason,
						status: row.review_status
					}
				: null,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

function escapeLike(value: string): string {
	return value.replaceAll('%', '\\%').replaceAll('_', '\\_');
}

interface TransactionRow extends DbRow {
	id: string;
	profile_id: string;
	account_id: string;
	account_name: string;
	import_batch_id: string | null;
	category_id: string | null;
	category_name: string | null;
	dedupe_key: string;
	booking_date: string;
	value_date: string | null;
	amount_cents: number;
	currency: 'EUR';
	original_amount_cents: number | null;
	original_currency: string | null;
	exchange_rate: string | null;
	balance_after_cents: number | null;
	payee: string | null;
	description: string | null;
	note: string | null;
	search_text: string;
	classification_status: TransactionClassificationStatus;
	review_flag_id: string | null;
	review_reason: string | null;
	review_status: string | null;
	created_at: string;
	updated_at: string;
}

interface CountRow extends DbRow {
	count: number;
}

interface TagRow extends DbRow {
	transaction_id: string;
	id: string;
	name: string;
	color: string | null;
}

interface TagOnlyRow extends DbRow {
	id: string;
	name: string;
	color: string | null;
}

interface RuleSourceRow extends DbRow {
	payee: string | null;
	search_text: string | null;
}

interface CategoryRuleRow extends DbRow {
	id: string;
	category_id: string;
	field: 'payee' | 'description' | 'note' | 'search_text';
	operator: 'contains' | 'equals' | 'starts_with' | 'regex';
	pattern: string;
	priority: number;
}

interface ReclassifyRow extends DbRow {
	id: string;
	payee: string | null;
	description: string | null;
	note: string | null;
	search_text: string;
	category_id: string | null;
	classification_status: TransactionClassificationStatus;
}

interface RuleMatchDraft {
	field: 'payee' | 'description' | 'note' | 'search_text';
	operator: 'contains' | 'equals' | 'starts_with' | 'regex';
	pattern: string;
}

interface RuleMatchRow extends DbRow {
	id: string;
	booking_date: string;
	amount_cents: number;
	payee: string | null;
	description: string | null;
	note: string | null;
	search_text: string;
}

interface RulePreviewRow {
	id: string;
	bookingDate: string;
	payee: string | null;
	amountCents: number;
}

interface IdRow extends DbRow {
	id: string;
}
