import { ValidationError } from '../accounts/errors';
import type {
	SortDirection,
	TransactionClassificationStatus,
	TransactionDirection,
	TransactionListFilters,
	TransactionSort,
	UpdateTransactionInput
} from './types';

const statuses = new Set<TransactionClassificationStatus>(['unknown', 'auto', 'manual', 'ignored']);
const sorts = new Set<TransactionSort>(['booking_date', 'amount_cents', 'payee']);
const directions = new Set<SortDirection>(['asc', 'desc']);
const transactionDirections = new Set<TransactionDirection>(['income', 'expense']);
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export function parseTransactionFilters(url: URL): TransactionListFilters {
	const direction = url.searchParams.get('direction');
	const transactionDirection =
		optionalTransactionDirection(
			url.searchParams.get('transactionDirection'),
			'transactionDirection'
		) ?? optionalTransactionDirection(direction, 'direction');
	const minAmountCents = optionalInteger(url.searchParams.get('minAmountCents'), 'minAmountCents');
	const maxAmountCents = optionalInteger(url.searchParams.get('maxAmountCents'), 'maxAmountCents');
	if (
		minAmountCents !== undefined &&
		maxAmountCents !== undefined &&
		minAmountCents > maxAmountCents
	) {
		throw new ValidationError('minAmountCents must be less than or equal to maxAmountCents');
	}

	return {
		accountId: optionalQueryString(url, 'accountId'),
		profileId: optionalQueryString(url, 'profileId'),
		categoryId: optionalQueryString(url, 'categoryId'),
		status: optionalStatus(url.searchParams.get('status')),
		transactionDirection,
		minAmountCents,
		maxAmountCents,
		tag: optionalQueryString(url, 'tag'),
		search: optionalQueryString(url, 'search'),
		from: optionalDate(url.searchParams.get('from'), 'from'),
		to: optionalDate(url.searchParams.get('to'), 'to'),
		sort: optionalSort(url.searchParams.get('sort')) ?? 'booking_date',
		direction:
			optionalDirection(url.searchParams.get('sortDirection'), 'sortDirection') ??
			optionalDirection(direction, 'direction') ??
			'desc',
		limit: optionalPositiveInteger(url.searchParams.get('limit'), 'limit') ?? 50,
		offset: optionalNonNegativeInteger(url.searchParams.get('offset'), 'offset') ?? 0
	};
}

export function parseUpdateTransactionInput(id: string, value: unknown): UpdateTransactionInput {
	const body = asObject(value);
	const input: UpdateTransactionInput = { id: requiredRouteId(id) };

	if ('categoryId' in body) {
		input.categoryId = optionalNullableString(body.categoryId, 'categoryId');
	}

	if ('note' in body) {
		input.note = optionalNullableString(body.note, 'note');
	}

	if ('tagNames' in body) {
		input.tagNames = requiredStringArray(body.tagNames, 'tagNames');
	}

	if ('createRule' in body) {
		input.createRule = requiredBoolean(body.createRule, 'createRule');
	}

	if ('ruleName' in body) {
		input.ruleName = requiredString(body.ruleName, 'ruleName');
	}

	if (Object.keys(input).length === 1) {
		throw new ValidationError('At least one transaction field must be updated');
	}

	return input;
}

function optionalQueryString(url: URL, field: string): string | undefined {
	const value = url.searchParams.get(field);
	if (value === null || value.trim() === '') {
		return undefined;
	}

	return value.trim();
}

function optionalStatus(value: string | null): TransactionClassificationStatus | undefined {
	if (value === null || value === '') {
		return undefined;
	}

	if (!statuses.has(value as TransactionClassificationStatus)) {
		throw new ValidationError('status must be one of unknown, auto, manual, ignored');
	}

	return value as TransactionClassificationStatus;
}

function optionalSort(value: string | null): TransactionSort | undefined {
	if (value === null || value === '') {
		return undefined;
	}

	if (!sorts.has(value as TransactionSort)) {
		throw new ValidationError('sort must be one of booking_date, amount_cents, payee');
	}

	return value as TransactionSort;
}

function optionalDirection(value: string | null, field: string): SortDirection | undefined {
	if (value === null || value === '') {
		return undefined;
	}

	if (!directions.has(value as SortDirection)) {
		if (field === 'direction' && transactionDirections.has(value as TransactionDirection)) {
			return undefined;
		}
		throw new ValidationError(`${field} must be one of asc, desc`);
	}

	return value as SortDirection;
}

function optionalTransactionDirection(
	value: string | null,
	field: string
): TransactionDirection | undefined {
	if (value === null || value === '') {
		return undefined;
	}

	if (!transactionDirections.has(value as TransactionDirection)) {
		if (field === 'direction') {
			return undefined;
		}
		throw new ValidationError(`${field} must be one of income, expense`);
	}

	return value as TransactionDirection;
}

function optionalDate(value: string | null, field: string): string | undefined {
	if (value === null || value === '') {
		return undefined;
	}

	if (!isoDatePattern.test(value)) {
		throw new ValidationError(`${field} must be an ISO date`);
	}

	return value;
}

function optionalPositiveInteger(value: string | null, field: string): number | undefined {
	if (value === null || value === '') {
		return undefined;
	}

	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
		throw new ValidationError(`${field} must be an integer between 1 and 200`);
	}

	return parsed;
}

function optionalInteger(value: string | null, field: string): number | undefined {
	if (value === null || value === '') {
		return undefined;
	}

	const parsed = Number(value);
	if (!Number.isInteger(parsed)) {
		throw new ValidationError(`${field} must be an integer`);
	}

	return parsed;
}

function optionalNonNegativeInteger(value: string | null, field: string): number | undefined {
	if (value === null || value === '') {
		return undefined;
	}

	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 0) {
		throw new ValidationError(`${field} must be a non-negative integer`);
	}

	return parsed;
}

function asObject(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new ValidationError('Request body must be a JSON object');
	}

	return value as Record<string, unknown>;
}

function requiredRouteId(value: string): string {
	if (value.trim() === '') {
		throw new ValidationError('id is required');
	}

	return value.trim();
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

function requiredStringArray(value: unknown, field: string): string[] {
	if (!Array.isArray(value)) {
		throw new ValidationError(`${field} must be an array of strings`);
	}

	const values = value.map((item) => requiredString(item, field));
	return [...new Set(values)];
}

function requiredBoolean(value: unknown, field: string): boolean {
	if (typeof value !== 'boolean') {
		throw new ValidationError(`${field} must be a boolean`);
	}

	return value;
}
