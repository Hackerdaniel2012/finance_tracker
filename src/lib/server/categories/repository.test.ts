import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	applySql,
	createTestDatabase,
	createTestDbClient
} from '../../../../tests/db/test-database';
import type { DbClient } from '../db-client';
import {
	createCategory,
	createCategoryRule,
	listCategories,
	listCategoryRules,
	updateCategory,
	updateCategoryRule
} from './repository';

let db: DbClient;

beforeEach(async () => {
	const sqlite = await createTestDatabase();
	applySql(sqlite, await readFile(resolve('migrations/0001_initial_schema.sql'), 'utf8'));
	applySql(sqlite, await readFile(resolve('migrations/0002_seed_default_categories.sql'), 'utf8'));
	db = createTestDbClient(sqlite);
});

describe('category repository', () => {
	it('lists seeded categories in sort order', async () => {
		const categories = await listCategories(db);

		expect(categories).toHaveLength(11);
		expect(categories[0]).toMatchObject({
			id: 'cat-income',
			name: 'Income',
			type: 'income',
			isDefault: true,
			sortOrder: 10
		});
		expect(categories.at(-1)).toMatchObject({ id: 'cat-unknown', type: 'unknown' });
	});

	it('creates and updates editable categories', async () => {
		const created = await createCategory(db, {
			name: 'Pets',
			type: 'expense',
			color: '#f97316',
			icon: 'paw-print',
			sortOrder: 75
		});

		expect(created).toMatchObject({
			name: 'Pets',
			type: 'expense',
			color: '#f97316',
			icon: 'paw-print',
			isDefault: false,
			sortOrder: 75
		});

		const updated = await updateCategory(db, {
			id: created.id,
			name: 'Pet Care',
			color: null,
			sortOrder: 76
		});

		expect(updated).toMatchObject({
			id: created.id,
			name: 'Pet Care',
			color: null,
			sortOrder: 76
		});
	});

	it('creates and updates global category rules', async () => {
		const rule = await createCategoryRule(db, {
			categoryId: 'cat-groceries',
			name: 'Groceries merchant',
			field: 'payee',
			operator: 'contains',
			pattern: 'REWE',
			priority: 20
		});

		expect(rule).toMatchObject({
			categoryId: 'cat-groceries',
			name: 'Groceries merchant',
			isGlobal: true,
			priority: 20
		});
		await expect(listCategoryRules(db)).resolves.toHaveLength(1);

		const updated = await updateCategoryRule(db, {
			id: rule.id,
			categoryId: 'cat-leisure',
			operator: 'equals',
			pattern: 'Cinema',
			isGlobal: false
		});

		expect(updated).toMatchObject({
			id: rule.id,
			categoryId: 'cat-leisure',
			operator: 'equals',
			pattern: 'Cinema',
			isGlobal: false
		});
	});

	it('returns not found errors for missing categories and rules', async () => {
		await expect(updateCategory(db, { id: 'missing', name: 'Nope' })).rejects.toThrow(
			'Category not found'
		);
		await expect(
			createCategoryRule(db, {
				categoryId: 'missing',
				name: 'Bad rule',
				field: 'payee',
				operator: 'contains',
				pattern: 'x'
			})
		).rejects.toThrow('Category not found');
		await expect(updateCategoryRule(db, { id: 'missing', name: 'Nope' })).rejects.toThrow(
			'Category rule not found'
		);
	});
});
