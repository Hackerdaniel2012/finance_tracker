import { ValidationError } from '../accounts/errors';
import type {
	CategoryType,
	CreateCategoryInput,
	CreateCategoryRuleInput,
	RuleField,
	RuleOperator,
	UpdateCategoryInput,
	UpdateCategoryRuleInput
} from './types';

const categoryTypes = new Set<CategoryType>([
	'income',
	'expense',
	'transfer',
	'investment',
	'unknown'
]);
const ruleFields = new Set<RuleField>(['payee', 'description', 'note', 'search_text']);
const ruleOperators = new Set<RuleOperator>(['contains', 'equals', 'starts_with', 'regex']);

export function parseCreateCategoryInput(value: unknown): CreateCategoryInput {
	const body = asObject(value);

	return {
		name: requiredString(body.name, 'name'),
		type: requiredCategoryType(body.type),
		color: optionalNullableString(body.color, 'color'),
		icon: optionalNullableString(body.icon, 'icon'),
		sortOrder: optionalInteger(body.sortOrder, 'sortOrder') ?? 0
	};
}

export function parseUpdateCategoryInput(value: unknown): UpdateCategoryInput {
	const body = asObject(value);
	const input: UpdateCategoryInput = {
		id: requiredString(body.id, 'id')
	};

	if ('name' in body) {
		input.name = requiredString(body.name, 'name');
	}

	if ('type' in body) {
		input.type = requiredCategoryType(body.type);
	}

	if ('color' in body) {
		input.color = optionalNullableString(body.color, 'color');
	}

	if ('icon' in body) {
		input.icon = optionalNullableString(body.icon, 'icon');
	}

	if ('sortOrder' in body) {
		input.sortOrder = requiredInteger(body.sortOrder, 'sortOrder');
	}

	if (Object.keys(input).length === 1) {
		throw new ValidationError('At least one category field must be updated');
	}

	return input;
}

export function parseCreateCategoryRuleInput(value: unknown): CreateCategoryRuleInput {
	const body = asObject(value);

	return {
		categoryId: requiredString(body.categoryId, 'categoryId'),
		name: requiredString(body.name, 'name'),
		field: requiredRuleField(body.field),
		operator: requiredRuleOperator(body.operator),
		pattern: requiredString(body.pattern, 'pattern'),
		priority: optionalInteger(body.priority, 'priority') ?? 100,
		isGlobal: optionalBoolean(body.isGlobal, 'isGlobal') ?? true
	};
}

export function parseUpdateCategoryRuleInput(value: unknown): UpdateCategoryRuleInput {
	const body = asObject(value);
	const input: UpdateCategoryRuleInput = {
		id: requiredString(body.id, 'id')
	};

	if ('categoryId' in body) {
		input.categoryId = requiredString(body.categoryId, 'categoryId');
	}

	if ('name' in body) {
		input.name = requiredString(body.name, 'name');
	}

	if ('field' in body) {
		input.field = requiredRuleField(body.field);
	}

	if ('operator' in body) {
		input.operator = requiredRuleOperator(body.operator);
	}

	if ('pattern' in body) {
		input.pattern = requiredString(body.pattern, 'pattern');
	}

	if ('priority' in body) {
		input.priority = requiredInteger(body.priority, 'priority');
	}

	if ('isGlobal' in body) {
		input.isGlobal = requiredBoolean(body.isGlobal, 'isGlobal');
	}

	if (Object.keys(input).length === 1) {
		throw new ValidationError('At least one category rule field must be updated');
	}

	return input;
}

function asObject(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new ValidationError('Request body must be a JSON object');
	}

	return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
	if (typeof value !== 'string' || value.trim() === '') {
		throw new ValidationError(`${field} is required`);
	}

	return value.trim();
}

function optionalNullableString(value: unknown, field: string): string | null | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (value === null || value === '') {
		return null;
	}

	if (typeof value !== 'string') {
		throw new ValidationError(`${field} must be a string or null`);
	}

	return value.trim();
}

function optionalInteger(value: unknown, field: string): number | undefined {
	if (value === undefined) {
		return undefined;
	}

	return requiredInteger(value, field);
}

function requiredInteger(value: unknown, field: string): number {
	if (typeof value !== 'number' || !Number.isInteger(value)) {
		throw new ValidationError(`${field} must be an integer`);
	}

	return value;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
	if (value === undefined) {
		return undefined;
	}

	return requiredBoolean(value, field);
}

function requiredBoolean(value: unknown, field: string): boolean {
	if (typeof value !== 'boolean') {
		throw new ValidationError(`${field} must be a boolean`);
	}

	return value;
}

function requiredCategoryType(value: unknown): CategoryType {
	if (typeof value !== 'string' || !categoryTypes.has(value as CategoryType)) {
		throw new ValidationError('type must be one of income, expense, transfer, investment, unknown');
	}

	return value as CategoryType;
}

function requiredRuleField(value: unknown): RuleField {
	if (typeof value !== 'string' || !ruleFields.has(value as RuleField)) {
		throw new ValidationError('field must be one of payee, description, note, search_text');
	}

	return value as RuleField;
}

function requiredRuleOperator(value: unknown): RuleOperator {
	if (typeof value !== 'string' || !ruleOperators.has(value as RuleOperator)) {
		throw new ValidationError('operator must be one of contains, equals, starts_with, regex');
	}

	return value as RuleOperator;
}
