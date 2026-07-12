import { ValidationError } from './errors';
import type { CreateAccountInput, UpdateAccountInput } from './types';

export function parseCreateAccountInput(value: unknown): CreateAccountInput {
	const body = asObject(value);
	const name = requiredString(body.name, 'name');

	return {
		name,
		institution: optionalNullableString(body.institution, 'institution'),
		openingBalanceCents: optionalInteger(body.openingBalanceCents, 'openingBalanceCents') ?? 0,
		currentBalanceCents: optionalNullableInteger(body.currentBalanceCents, 'currentBalanceCents'),
		displayOrder: optionalInteger(body.displayOrder, 'displayOrder') ?? 0
	};
}

export function parseUpdateAccountInput(value: unknown): UpdateAccountInput {
	const body = asObject(value);
	const id = requiredString(body.id, 'id');
	const input: UpdateAccountInput = { id };

	if ('name' in body) {
		input.name = requiredString(body.name, 'name');
	}

	if ('institution' in body) {
		input.institution = optionalNullableString(body.institution, 'institution');
	}

	if ('openingBalanceCents' in body) {
		input.openingBalanceCents = requiredInteger(body.openingBalanceCents, 'openingBalanceCents');
	}

	if ('currentBalanceCents' in body) {
		input.currentBalanceCents = optionalNullableInteger(
			body.currentBalanceCents,
			'currentBalanceCents'
		);
	}

	if ('displayOrder' in body) {
		input.displayOrder = requiredInteger(body.displayOrder, 'displayOrder');
	}

	if (Object.keys(input).length === 1) {
		throw new ValidationError('At least one account field must be updated');
	}

	return input;
}

export function parseDeleteAccountInput(value: unknown): { id: string } {
	return { id: requiredString(asObject(value).id, 'id') };
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

function optionalNullableInteger(value: unknown, field: string): number | null | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (value === null) {
		return null;
	}

	return requiredInteger(value, field);
}

function requiredInteger(value: unknown, field: string): number {
	if (typeof value !== 'number' || !Number.isInteger(value)) {
		throw new ValidationError(`${field} must be an integer`);
	}

	return value;
}
