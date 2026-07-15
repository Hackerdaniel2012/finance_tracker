import { NotFoundError, ValidationError } from '../accounts/errors';
import { matchesCategoryRule } from '../categories/matcher';
import type { DbClient, DbRow, DbStatement, DbValue } from '../db-client';
import { applyCategoryMutationsAndRematch, type CategoryMutation } from '../plans/rematching';
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
	if (existing.kind === 'combined_import') {
		throw new ValidationError('Combined import transactions are read-only');
	}

	if (input.categoryId !== undefined && input.categoryId !== null) {
		await assertCategoryExists(db, input.categoryId);
	}
	const categoryMutations: CategoryMutation[] = [];
	if (input.categoryId !== undefined && input.categoryId !== existing.categoryId) {
		categoryMutations.push({ transactionId: input.id, categoryId: input.categoryId });
	}

	let preparedRule: PreparedRuleApplication | null = null;
	if (input.createRule === true) {
		const categoryId = input.categoryId ?? existing.categoryId;
		if (!categoryId) {
			throw new ValidationError('categoryId is required to create a category rule');
		}
		preparedRule = await prepareRuleFromTransaction(db, {
			transactionId: input.id,
			categoryId,
			ruleName: input.ruleName,
			applyToExisting: input.applyRuleToExisting === true,
			payee: existing.payee,
			searchText: existing.searchText
		});
	}

	const statements: DbStatement[] = [
		db
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
	];

	if (input.tagNames !== undefined) {
		statements.push(...prepareTransactionTagStatements(db, input.id, input.tagNames));
	}

	if (input.categoryId) {
		statements.push(resolveReviewFlagStatement(db, input.id));
	}

	if (preparedRule) {
		statements.push(...preparedRule.statements);
		categoryMutations.push(...preparedRule.categoryMutations);
	}

	await applyCategoryMutationsAndRematch(db, categoryMutations, statements);

	const updated = await getTransaction(db, input.id);
	if (!updated) {
		throw new NotFoundError('Transaction not found');
	}

	return { ...updated, classifiedCount: 1, bulkAppliedCount: preparedRule?.count ?? 0 };
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
		t.account_id,
		a.name AS account_name,
		t.kind,
		t.subaccount,
		b.combine_before_date,
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
	LEFT JOIN import_batches b ON b.id = t.import_batch_id
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

function prepareTransactionTagStatements(
	db: DbClient,
	transactionId: string,
	tagNames: string[]
): DbStatement[] {
	const statements: DbStatement[] = [
		db.prepare('DELETE FROM transaction_tags WHERE transaction_id = ?').bind(transactionId)
	];

	for (const tagName of tagNames) {
		statements.push(
			db
				.prepare('INSERT OR IGNORE INTO tags (id, name) VALUES (?, ?)')
				.bind(crypto.randomUUID(), tagName),
			db
				.prepare(
					`INSERT OR IGNORE INTO transaction_tags (transaction_id, tag_id)
					SELECT ?, id FROM tags WHERE name = ?`
				)
				.bind(transactionId, tagName)
		);
	}
	return statements;
}

function resolveReviewFlagStatement(db: DbClient, transactionId: string): DbStatement {
	return db
		.prepare(
			`UPDATE transaction_review_flags
			SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP
			WHERE transaction_id = ?
				AND status = 'open'`
		)
		.bind(transactionId);
}

async function prepareRuleFromTransaction(
	db: DbClient,
	input: {
		transactionId: string;
		categoryId: string;
		ruleName?: string;
		applyToExisting: boolean;
		payee: string | null;
		searchText: string;
	}
): Promise<PreparedRuleApplication> {
	const pattern = input.payee?.trim() || input.searchText.trim();
	if (!pattern) {
		throw new ValidationError('Transaction needs payee or search text to create a category rule');
	}

	const field = input.payee?.trim() ? 'payee' : 'search_text';
	const statements: DbStatement[] = [
		db
			.prepare(
				`INSERT INTO category_rules (id, category_id, name, field, operator, pattern, priority, is_global)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.bind(
				crypto.randomUUID(),
				input.categoryId,
				input.ruleName ?? `Match ${pattern}`,
				field,
				'contains',
				pattern,
				100,
				1
			)
	];

	if (!input.applyToExisting) return { count: 0, categoryMutations: [], statements };
	const rows = (await listUnknownRuleRows(db)).filter(
		(row) =>
			row.id !== input.transactionId &&
			matchesCategoryRule(mapRuleSource(row), {
				field,
				operator: 'contains',
				pattern
			})
	);
	const categoryMutations = rows
		.filter((row) => row.category_id !== input.categoryId)
		.map((row) => ({ transactionId: row.id, categoryId: input.categoryId }));
	statements.push(
		...prepareBulkCategoryStatements(
			db,
			rows.map((row) => row.id),
			input.categoryId,
			'auto'
		),
		...prepareReviewResolutionStatements(
			db,
			rows.map((row) => row.id)
		)
	);
	return { count: rows.length, categoryMutations, statements };
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

		if (
			row.category_id === newCategoryId &&
			(isMatched || row.classification_status === 'unknown')
		) {
			continue;
		}

		if (isMatched && newCategoryId) {
			toCategorize.push({ row, newCategoryId });
		} else {
			toUncategorize.push(row);
		}
	}

	const statements: DbStatement[] = [];
	const categorizedByCategory = new Map<string, string[]>();
	for (const { row, newCategoryId } of toCategorize) {
		const ids = categorizedByCategory.get(newCategoryId) ?? [];
		ids.push(row.id);
		categorizedByCategory.set(newCategoryId, ids);
	}
	for (const [categoryId, ids] of categorizedByCategory) {
		statements.push(
			...prepareBulkCategoryStatements(db, ids, categoryId, 'auto'),
			...prepareReviewResolutionStatements(db, ids)
		);
	}
	statements.push(
		...prepareBulkCategoryStatements(
			db,
			toUncategorize.map((row) => row.id),
			null,
			'unknown'
		)
	);
	for (const row of toUncategorize) {
		statements.push(
			db
				.prepare(
					`INSERT OR IGNORE INTO transaction_review_flags (id, transaction_id, reason)
					VALUES (?, ?, 'unknown_category')`
				)
				.bind(crypto.randomUUID(), row.id)
		);
	}

	await applyCategoryMutationsAndRematch(
		db,
		[
			...toCategorize.map(({ row, newCategoryId }) => ({
				transactionId: row.id,
				categoryId: newCategoryId
			})),
			...toUncategorize
				.filter((row) => row.category_id !== null)
				.map((row) => ({ transactionId: row.id, categoryId: null }))
		],
		statements
	);

	return {
		updatedCount: toCategorize.length + toUncategorize.length,
		matchedCount: toCategorize.length,
		unmatchedCount: toUncategorize.length
	};
}

function prepareBulkCategoryStatements(
	db: DbClient,
	transactionIds: string[],
	categoryId: string | null,
	status: 'auto' | 'unknown'
): DbStatement[] {
	const statements: DbStatement[] = [];
	for (let offset = 0; offset < transactionIds.length; offset += 100) {
		const chunk = transactionIds.slice(offset, offset + 100);
		statements.push(
			db
				.prepare(
					`UPDATE transactions
					SET category_id = ?, classification_status = ?, updated_at = CURRENT_TIMESTAMP
					WHERE id IN (${chunk.map(() => '?').join(', ')})`
				)
				.bind(categoryId, status, ...chunk)
		);
	}
	return statements;
}

function prepareReviewResolutionStatements(db: DbClient, transactionIds: string[]): DbStatement[] {
	const statements: DbStatement[] = [];
	for (let offset = 0; offset < transactionIds.length; offset += 100) {
		const chunk = transactionIds.slice(offset, offset + 100);
		statements.push(
			db
				.prepare(
					`UPDATE transaction_review_flags
					SET status = 'resolved', resolved_at = CURRENT_TIMESTAMP
					WHERE transaction_id IN (${chunk.map(() => '?').join(', ')}) AND status = 'open'`
				)
				.bind(...chunk)
		);
	}
	return statements;
}

async function listUnknownRuleRows(db: DbClient): Promise<RuleMatchRow[]> {
	const { results } = await db
		.prepare(
			`SELECT id, booking_date, amount_cents, payee, description, note, search_text, category_id
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
		accountId: row.account_id,
		accountName: row.account_name,
		kind: row.kind,
		subaccount: row.subaccount,
		combineBeforeDate: row.combine_before_date,
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
	account_id: string;
	account_name: string;
	kind: Transaction['kind'];
	subaccount: string | null;
	combine_before_date: string | null;
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
	category_id: string | null;
}

interface PreparedRuleApplication {
	count: number;
	categoryMutations: CategoryMutation[];
	statements: DbStatement[];
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
