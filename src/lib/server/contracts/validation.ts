import { ValidationError } from '../accounts/errors';
import type {
	ContractCadence,
	ContractKind,
	ContractSource,
	ContractStatus,
	CreateContractInput,
	UpdateContractInput
} from './types';

const kinds = new Set<ContractKind>(['fixed_cost', 'subscription', 'salary', 'income', 'other']);
const cadences = new Set<ContractCadence>(['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly']);
const statuses = new Set<ContractStatus>(['active', 'paused', 'ended']);
const sources = new Set<ContractSource>(['manual', 'imported', 'confirmed_recurring']);
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export function parseCreateContractInput(value: unknown): CreateContractInput {
	const body = asObject(value);

	return {
		accountId: optionalNullableString(body.accountId, 'accountId'),
		profileId: optionalNullableString(body.profileId, 'profileId'),
		categoryId: optionalNullableString(body.categoryId, 'categoryId'),
		name: requiredString(body.name, 'name'),
		payee: optionalNullableString(body.payee, 'payee'),
		kind: requiredKind(body.kind),
		cadence: requiredCadence(body.cadence),
		expectedAmountCents: requiredPositiveInteger(body.expectedAmountCents, 'expectedAmountCents'),
		nextDate: requiredDate(body.nextDate, 'nextDate'),
		endDate: optionalNullableDate(body.endDate, 'endDate'),
		status: optionalStatus(body.status) ?? 'active',
		source: optionalSource(body.source) ?? 'manual'
	};
}

export function parseUpdateContractInput(value: unknown): UpdateContractInput {
	const body = asObject(value);
	const input: UpdateContractInput = { id: requiredString(body.id, 'id') };

	if ('accountId' in body) input.accountId = optionalNullableString(body.accountId, 'accountId');
	if ('profileId' in body) input.profileId = optionalNullableString(body.profileId, 'profileId');
	if ('categoryId' in body)
		input.categoryId = optionalNullableString(body.categoryId, 'categoryId');
	if ('name' in body) input.name = requiredString(body.name, 'name');
	if ('payee' in body) input.payee = optionalNullableString(body.payee, 'payee');
	if ('kind' in body) input.kind = requiredKind(body.kind);
	if ('cadence' in body) input.cadence = requiredCadence(body.cadence);
	if ('expectedAmountCents' in body) {
		input.expectedAmountCents = requiredPositiveInteger(
			body.expectedAmountCents,
			'expectedAmountCents'
		);
	}
	if ('nextDate' in body) input.nextDate = requiredDate(body.nextDate, 'nextDate');
	if ('endDate' in body) input.endDate = optionalNullableDate(body.endDate, 'endDate');
	if ('status' in body) input.status = requiredStatus(body.status);
	if ('source' in body) input.source = requiredSource(body.source);

	if (Object.keys(input).length === 1) {
		throw new ValidationError('At least one contract field must be updated');
	}

	return input;
}

export function parseDeleteContractInput(value: unknown): { id: string } {
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

function requiredKind(value: unknown): ContractKind {
	if (typeof value !== 'string' || !kinds.has(value as ContractKind)) {
		throw new ValidationError(
			'kind must be one of fixed_cost, subscription, salary, income, other'
		);
	}

	return value as ContractKind;
}

function requiredCadence(value: unknown): ContractCadence {
	if (typeof value !== 'string' || !cadences.has(value as ContractCadence)) {
		throw new ValidationError(
			'cadence must be one of weekly, biweekly, monthly, quarterly, yearly'
		);
	}

	return value as ContractCadence;
}

function optionalStatus(value: unknown): ContractStatus | undefined {
	if (value === undefined) return undefined;
	return requiredStatus(value);
}

function requiredStatus(value: unknown): ContractStatus {
	if (typeof value !== 'string' || !statuses.has(value as ContractStatus)) {
		throw new ValidationError('status must be one of active, paused, ended');
	}

	return value as ContractStatus;
}

function optionalSource(value: unknown): ContractSource | undefined {
	if (value === undefined) return undefined;
	return requiredSource(value);
}

function requiredSource(value: unknown): ContractSource {
	if (typeof value !== 'string' || !sources.has(value as ContractSource)) {
		throw new ValidationError('source must be one of manual, imported, confirmed_recurring');
	}

	return value as ContractSource;
}
