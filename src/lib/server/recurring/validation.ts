import { ValidationError } from '../accounts/errors';
import type {
	RecurringCadence,
	RecurringDirection,
	RecurringSource,
	RecurringStatus,
	UpdateRecurringGroupInput
} from './types';

const cadences = new Set<RecurringCadence>([
	'weekly',
	'biweekly',
	'monthly',
	'quarterly',
	'yearly'
]);
const statuses = new Set<RecurringStatus>(['suggested', 'confirmed', 'ignored']);
const sources = new Set<RecurringSource>(['manual', 'imported', 'confirmed_suggestion']);
const directions = new Set<RecurringDirection>(['incoming', 'outgoing']);
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export function parseUpdateRecurringGroupInput(
	id: string,
	value: unknown
): UpdateRecurringGroupInput {
	const body = asObject(value);
	const input: UpdateRecurringGroupInput = { id: requiredString(id, 'id') };

	if ('accountId' in body) input.accountId = optionalNullableString(body.accountId, 'accountId');
	if ('profileId' in body) input.profileId = optionalNullableString(body.profileId, 'profileId');
	if ('categoryId' in body)
		input.categoryId = optionalNullableString(body.categoryId, 'categoryId');
	if ('payee' in body) input.payee = requiredString(body.payee, 'payee');
	if ('direction' in body) input.direction = requiredDirection(body.direction);
	if ('cadence' in body) input.cadence = requiredCadence(body.cadence);
	if ('expectedAmountCents' in body) {
		input.expectedAmountCents = requiredPositiveInteger(
			body.expectedAmountCents,
			'expectedAmountCents'
		);
	}
	if ('nextDate' in body) input.nextDate = optionalNullableDate(body.nextDate, 'nextDate');
	if ('status' in body) input.status = requiredStatus(body.status);
	if ('confidence' in body) input.confidence = requiredConfidence(body.confidence);
	if ('source' in body) input.source = requiredSource(body.source);

	if (Object.keys(input).length === 1) {
		throw new ValidationError('At least one recurring group field must be updated');
	}
	if (input.status === 'confirmed') {
		if (
			!input.direction ||
			!input.categoryId ||
			!input.cadence ||
			!input.expectedAmountCents ||
			!input.nextDate
		) {
			throw new ValidationError(
				'Confirming a recurring group requires direction, categoryId, cadence, expectedAmountCents, and nextDate'
			);
		}
	}

	return input;
}

function requiredDirection(value: unknown): RecurringDirection {
	if (typeof value !== 'string' || !directions.has(value as RecurringDirection)) {
		throw new ValidationError('direction must be incoming or outgoing');
	}
	return value as RecurringDirection;
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
	if (value === undefined) return undefined;
	if (value === null || value === '') return null;
	if (typeof value !== 'string') {
		throw new ValidationError(`${field} must be a string or null`);
	}

	return value.trim();
}

function requiredPositiveInteger(value: unknown, field: string): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
		throw new ValidationError(`${field} must be a positive integer`);
	}

	return value;
}

function requiredConfidence(value: unknown): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100) {
		throw new ValidationError('confidence must be an integer between 0 and 100');
	}

	return value;
}

function optionalNullableDate(value: unknown, field: string): string | null | undefined {
	if (value === undefined) return undefined;
	if (value === null || value === '') return null;

	return requiredDate(value, field);
}

function requiredDate(value: unknown, field: string): string {
	const date = requiredString(value, field);
	if (!isoDatePattern.test(date)) {
		throw new ValidationError(`${field} must be an ISO date`);
	}

	const parsed = new Date(`${date}T00:00:00.000Z`);
	if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
		throw new ValidationError(`${field} must be an ISO date`);
	}

	return date;
}

function requiredCadence(value: unknown): RecurringCadence {
	if (typeof value !== 'string' || !cadences.has(value as RecurringCadence)) {
		throw new ValidationError(
			'cadence must be one of weekly, biweekly, monthly, quarterly, yearly'
		);
	}

	return value as RecurringCadence;
}

function requiredStatus(value: unknown): RecurringStatus {
	if (typeof value !== 'string' || !statuses.has(value as RecurringStatus)) {
		throw new ValidationError('status must be one of suggested, confirmed, ignored');
	}

	return value as RecurringStatus;
}

function requiredSource(value: unknown): RecurringSource {
	if (typeof value !== 'string' || !sources.has(value as RecurringSource)) {
		throw new ValidationError('source must be one of manual, imported, confirmed_suggestion');
	}

	return value as RecurringSource;
}
