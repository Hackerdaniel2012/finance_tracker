import { NotFoundError } from '../accounts/errors';
import type { DbClient, DbRow } from '../db-client';
import type {
	Category,
	CategoryRule,
	CreateCategoryInput,
	CreateCategoryRuleInput,
	UpdateCategoryInput,
	UpdateCategoryRuleInput
} from './types';

export async function listCategories(db: DbClient): Promise<Category[]> {
	const { results } = await db
		.prepare(
			`SELECT id, name, type, color, icon, is_default, sort_order, created_at, updated_at
			FROM categories
			ORDER BY sort_order ASC, name ASC`
		)
		.all<CategoryRow>();

	return results.map(mapCategory);
}

export async function createCategory(db: DbClient, input: CreateCategoryInput): Promise<Category> {
	const id = crypto.randomUUID();

	await db
		.prepare(
			`INSERT INTO categories (id, name, type, color, icon, sort_order)
			VALUES (?, ?, ?, ?, ?, ?)`
		)
		.bind(id, input.name, input.type, input.color ?? null, input.icon ?? null, input.sortOrder ?? 0)
		.run();

	const category = await getCategory(db, id);
	if (!category) {
		throw new NotFoundError('Created category could not be loaded');
	}

	return category;
}

export async function updateCategory(db: DbClient, input: UpdateCategoryInput): Promise<Category> {
	const existing = await getCategory(db, input.id);
	if (!existing) {
		throw new NotFoundError('Category not found');
	}

	await db
		.prepare(
			`UPDATE categories
			SET
				name = ?,
				type = ?,
				color = ?,
				icon = ?,
				sort_order = ?,
				updated_at = CURRENT_TIMESTAMP
			WHERE id = ?`
		)
		.bind(
			input.name ?? existing.name,
			input.type ?? existing.type,
			input.color === undefined ? existing.color : input.color,
			input.icon === undefined ? existing.icon : input.icon,
			input.sortOrder ?? existing.sortOrder,
			input.id
		)
		.run();

	const category = await getCategory(db, input.id);
	if (!category) {
		throw new NotFoundError('Category not found');
	}

	return category;
}

export async function listCategoryRules(db: DbClient): Promise<CategoryRule[]> {
	const { results } = await db
		.prepare(
			`SELECT id, category_id, name, field, operator, pattern, priority, is_global, created_at, updated_at
			FROM category_rules
			ORDER BY priority ASC, created_at ASC`
		)
		.all<CategoryRuleRow>();

	return results.map(mapCategoryRule);
}

export async function createCategoryRule(
	db: DbClient,
	input: CreateCategoryRuleInput
): Promise<CategoryRule> {
	await assertCategoryExists(db, input.categoryId);
	const id = crypto.randomUUID();

	await db
		.prepare(
			`INSERT INTO category_rules (
				id, category_id, name, field, operator, pattern, priority, is_global
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			id,
			input.categoryId,
			input.name,
			input.field,
			input.operator,
			input.pattern,
			input.priority ?? 100,
			input.isGlobal === false ? 0 : 1
		)
		.run();

	const rule = await getCategoryRule(db, id);
	if (!rule) {
		throw new NotFoundError('Created category rule could not be loaded');
	}

	return rule;
}

export async function updateCategoryRule(
	db: DbClient,
	input: UpdateCategoryRuleInput
): Promise<CategoryRule> {
	const existing = await getCategoryRule(db, input.id);
	if (!existing) {
		throw new NotFoundError('Category rule not found');
	}

	const categoryId = input.categoryId ?? existing.categoryId;
	if (categoryId !== existing.categoryId) {
		await assertCategoryExists(db, categoryId);
	}

	await db
		.prepare(
			`UPDATE category_rules
			SET
				category_id = ?,
				name = ?,
				field = ?,
				operator = ?,
				pattern = ?,
				priority = ?,
				is_global = ?,
				updated_at = CURRENT_TIMESTAMP
			WHERE id = ?`
		)
		.bind(
			categoryId,
			input.name ?? existing.name,
			input.field ?? existing.field,
			input.operator ?? existing.operator,
			input.pattern ?? existing.pattern,
			input.priority ?? existing.priority,
			input.isGlobal === undefined ? boolToInt(existing.isGlobal) : boolToInt(input.isGlobal),
			input.id
		)
		.run();

	const rule = await getCategoryRule(db, input.id);
	if (!rule) {
		throw new NotFoundError('Category rule not found');
	}

	return rule;
}

async function getCategory(db: DbClient, id: string): Promise<Category | null> {
	const row = await db
		.prepare(
			`SELECT id, name, type, color, icon, is_default, sort_order, created_at, updated_at
			FROM categories
			WHERE id = ?`
		)
		.bind(id)
		.first<CategoryRow>();

	return row ? mapCategory(row) : null;
}

async function getCategoryRule(db: DbClient, id: string): Promise<CategoryRule | null> {
	const row = await db
		.prepare(
			`SELECT id, category_id, name, field, operator, pattern, priority, is_global, created_at, updated_at
			FROM category_rules
			WHERE id = ?`
		)
		.bind(id)
		.first<CategoryRuleRow>();

	return row ? mapCategoryRule(row) : null;
}

async function assertCategoryExists(db: DbClient, id: string): Promise<void> {
	if (!(await getCategory(db, id))) {
		throw new NotFoundError('Category not found');
	}
}

function mapCategory(row: CategoryRow): Category {
	return {
		id: row.id,
		name: row.name,
		type: row.type,
		color: row.color,
		icon: row.icon,
		isDefault: row.is_default === 1,
		sortOrder: row.sort_order,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

function mapCategoryRule(row: CategoryRuleRow): CategoryRule {
	return {
		id: row.id,
		categoryId: row.category_id,
		name: row.name,
		field: row.field,
		operator: row.operator,
		pattern: row.pattern,
		priority: row.priority,
		isGlobal: row.is_global === 1,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

function boolToInt(value: boolean): 0 | 1 {
	return value ? 1 : 0;
}

interface CategoryRow extends DbRow {
	id: string;
	name: string;
	type: Category['type'];
	color: string | null;
	icon: string | null;
	is_default: number;
	sort_order: number;
	created_at: string;
	updated_at: string;
}

interface CategoryRuleRow extends DbRow {
	id: string;
	category_id: string;
	name: string;
	field: CategoryRule['field'];
	operator: CategoryRule['operator'];
	pattern: string;
	priority: number;
	is_global: number;
	created_at: string;
	updated_at: string;
}
