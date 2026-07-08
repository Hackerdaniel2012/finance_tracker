import { ValidationError } from '../accounts/errors';
import type { CreateLiabilityInput, LiabilityStatus, UpdateLiabilityInput } from './types';

const statuses = new Set<LiabilityStatus>(['active', 'cleared']);
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export function parseCreateLiabilityInput(value: unknown): CreateLiabilityInput {
	const body = asObject(value);

	return {
		accountId: optionalNullableString(body.accountId, 'accountId'),
		name: requiredString(body.name, 'name'),
		amountCents: requiredPositiveInteger(body.amountCents, 'amountCents'),
		asOfDate: requiredDate(body.asOfDate, 'asOfDate'),
		status: optionalStatus(body.status) ?? 'active',
		note: optionalNullableString(body.note, 'note')
	};
}

export function parseUpdateLiabilityInput(value: unknown): UpdateLiabilityInput {
	const body = asObject(value);
	const input: UpdateLiabilityInput = {
		id: requiredString(body.id, 'id')
	};

	if ('accountId' in body) {
		input.accountId = optionalNullableString(body.accountId, 'accountId');
	}

	if ('name' in body) {
		input.name = requiredString(body.name, 'name');
	}

	if ('amountCents' in body) {
		input.amountCents = requiredPositiveInteger(body.amountCents, 'amountCents');
	}

	if ('asOfDate' in body) {
		input.asOfDate = requiredDate(body.asOfDate, 'asOfDate');
	}

	if ('status' in body) {
		input.status = requiredStatus(body.status);
	}

	if ('note' in body) {
		input.note = optionalNullableString(body.note, 'note');
	}

	if (Object.keys(input).length === 1) {
		throw new ValidationError('At least one liability field must be updated');
	}

	return input;
}

export function parseDeleteLiabilityInput(value: unknown): { id: string } {
	const body = asObject(value);

	return {
		id: requiredString(body.id, 'id')
	};
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

function requiredPositiveInteger(value: unknown, field: string): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
		throw new ValidationError(`${field} must be a positive integer`);
	}

	return value;
}

function requiredDate(value: unknown, field: string): string {
	const date = requiredString(value, field);
	if (!isoDatePattern.test(date)) {
		throw new ValidationError(`${field} must be an ISO date`);
	}

	return date;
}

function optionalStatus(value: unknown): LiabilityStatus | undefined {
	if (value === undefined) {
		return undefined;
	}

	return requiredStatus(value);
}

function requiredStatus(value: unknown): LiabilityStatus {
	if (typeof value !== 'string' || !statuses.has(value as LiabilityStatus)) {
		throw new ValidationError('status must be one of active, cleared');
	}

	return value as LiabilityStatus;
}
