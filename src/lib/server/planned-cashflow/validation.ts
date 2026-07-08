import { ValidationError } from '../accounts/errors';
import type {
	CreatePlannedIncomeInput,
	CreatePlannedPaymentInput,
	PlannedIncomeStatus,
	PlannedPaymentStatus,
	UpdatePlannedIncomeInput,
	UpdatePlannedPaymentInput
} from './types';

const paymentStatuses = new Set<PlannedPaymentStatus>(['planned', 'paid', 'cancelled']);
const incomeStatuses = new Set<PlannedIncomeStatus>(['planned', 'received', 'cancelled']);
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export function parseCreatePlannedPaymentInput(value: unknown): CreatePlannedPaymentInput {
	const body = asObject(value);

	return {
		accountId: optionalNullableString(body.accountId, 'accountId'),
		categoryId: optionalNullableString(body.categoryId, 'categoryId'),
		payee: requiredString(body.payee, 'payee'),
		amountCents: requiredPositiveInteger(body.amountCents, 'amountCents'),
		dueDate: requiredDate(body.dueDate, 'dueDate'),
		status: optionalPaymentStatus(body.status) ?? 'planned',
		note: optionalNullableString(body.note, 'note')
	};
}

export function parseUpdatePlannedPaymentInput(value: unknown): UpdatePlannedPaymentInput {
	const body = asObject(value);
	const input: UpdatePlannedPaymentInput = { id: requiredString(body.id, 'id') };

	if ('accountId' in body) input.accountId = optionalNullableString(body.accountId, 'accountId');
	if ('categoryId' in body)
		input.categoryId = optionalNullableString(body.categoryId, 'categoryId');
	if ('payee' in body) input.payee = requiredString(body.payee, 'payee');
	if ('amountCents' in body) {
		input.amountCents = requiredPositiveInteger(body.amountCents, 'amountCents');
	}
	if ('dueDate' in body) input.dueDate = requiredDate(body.dueDate, 'dueDate');
	if ('status' in body) input.status = requiredPaymentStatus(body.status);
	if ('note' in body) input.note = optionalNullableString(body.note, 'note');

	if (Object.keys(input).length === 1) {
		throw new ValidationError('At least one planned payment field must be updated');
	}

	return input;
}

export function parseDeletePlannedPaymentInput(value: unknown): { id: string } {
	return { id: requiredString(asObject(value).id, 'id') };
}

export function parseCreatePlannedIncomeInput(value: unknown): CreatePlannedIncomeInput {
	const body = asObject(value);

	return {
		accountId: optionalNullableString(body.accountId, 'accountId'),
		categoryId: optionalNullableString(body.categoryId, 'categoryId'),
		payer: requiredString(body.payer, 'payer'),
		amountCents: requiredPositiveInteger(body.amountCents, 'amountCents'),
		dueDate: requiredDate(body.dueDate, 'dueDate'),
		status: optionalIncomeStatus(body.status) ?? 'planned',
		note: optionalNullableString(body.note, 'note')
	};
}

export function parseUpdatePlannedIncomeInput(value: unknown): UpdatePlannedIncomeInput {
	const body = asObject(value);
	const input: UpdatePlannedIncomeInput = { id: requiredString(body.id, 'id') };

	if ('accountId' in body) input.accountId = optionalNullableString(body.accountId, 'accountId');
	if ('categoryId' in body)
		input.categoryId = optionalNullableString(body.categoryId, 'categoryId');
	if ('payer' in body) input.payer = requiredString(body.payer, 'payer');
	if ('amountCents' in body) {
		input.amountCents = requiredPositiveInteger(body.amountCents, 'amountCents');
	}
	if ('dueDate' in body) input.dueDate = requiredDate(body.dueDate, 'dueDate');
	if ('status' in body) input.status = requiredIncomeStatus(body.status);
	if ('note' in body) input.note = optionalNullableString(body.note, 'note');

	if (Object.keys(input).length === 1) {
		throw new ValidationError('At least one planned income field must be updated');
	}

	return input;
}

export function parseDeletePlannedIncomeInput(value: unknown): { id: string } {
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

function requiredDate(value: unknown, field: string): string {
	const date = requiredString(value, field);
	if (!isoDatePattern.test(date)) {
		throw new ValidationError(`${field} must be an ISO date`);
	}

	return date;
}

function optionalPaymentStatus(value: unknown): PlannedPaymentStatus | undefined {
	if (value === undefined) return undefined;
	return requiredPaymentStatus(value);
}

function requiredPaymentStatus(value: unknown): PlannedPaymentStatus {
	if (typeof value !== 'string' || !paymentStatuses.has(value as PlannedPaymentStatus)) {
		throw new ValidationError('status must be one of planned, paid, cancelled');
	}

	return value as PlannedPaymentStatus;
}

function optionalIncomeStatus(value: unknown): PlannedIncomeStatus | undefined {
	if (value === undefined) return undefined;
	return requiredIncomeStatus(value);
}

function requiredIncomeStatus(value: unknown): PlannedIncomeStatus {
	if (typeof value !== 'string' || !incomeStatuses.has(value as PlannedIncomeStatus)) {
		throw new ValidationError('status must be one of planned, received, cancelled');
	}

	return value as PlannedIncomeStatus;
}
