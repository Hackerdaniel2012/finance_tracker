import { ValidationError } from '../accounts/errors';
import { optionalIsoDate, requireIsoDate } from '../date-validation';
import type {
	CreatePlanInput,
	PlanCadence,
	PlanDirection,
	PlanStatus,
	UpdatePlanInput
} from './types';

const directions = new Set<PlanDirection>(['expense', 'income']);
const cadences = new Set<PlanCadence>([
	'once',
	'daily',
	'weekly',
	'biweekly',
	'monthly',
	'quarterly',
	'yearly'
]);
const statuses = new Set<PlanStatus>(['active', 'paused', 'done', 'cancelled']);

export function parseCreatePlanInput(value: unknown): CreatePlanInput {
	const body = object(value);
	if ('liabilityId' in body)
		throw new ValidationError('liabilityId can only be managed through liability plan operations');
	if ('source' in body || 'sourceRecurringGroupId' in body)
		throw new ValidationError(
			'Recurring suggestion provenance can only be managed through the confirm endpoint'
		);
	const input: CreatePlanInput = {
		accountId: nullableString(body.accountId, 'accountId'),
		categoryId: nullableString(body.categoryId, 'categoryId'),
		label: nullableString(body.label, 'label'),
		counterparty: nullableString(body.counterparty, 'counterparty'),
		direction: enumValue(body.direction, directions, 'direction'),
		cadence: enumValue(body.cadence, cadences, 'cadence'),
		amountCents: positiveInt(body.amountCents, 'amountCents'),
		nextDate: requireIsoDate(body.nextDate, 'nextDate'),
		endDate: optionalIsoDate(body.endDate, 'endDate'),
		status: optionalEnum(body.status, statuses, 'status') ?? 'active',
		note: nullableString(body.note, 'note')
	};
	if ('liability' in body && body.liability !== null) {
		const liability = object(body.liability);
		input.liability = {
			name: requiredString(liability.name, 'liability.name'),
			amountCents: positiveInt(liability.amountCents, 'liability.amountCents'),
			asOfDate: requireIsoDate(liability.asOfDate, 'liability.asOfDate'),
			annualInterestRateBps: nonNegativeInt(
				liability.annualInterestRateBps,
				'liability.annualInterestRateBps'
			)
		};
		if (input.direction !== 'expense')
			throw new ValidationError('Liabilities require an expense plan');
		if (input.cadence === 'once') throw new ValidationError('Liabilities require a recurring plan');
		input.categoryId = 'cat-installment-plan';
	}
	assertPlanDates(input);
	return input;
}

export function parseUpdatePlanInput(value: unknown): UpdatePlanInput {
	const body = object(value);
	if ('liabilityId' in body)
		throw new ValidationError('liabilityId can only be managed through liability plan operations');
	const input: UpdatePlanInput = { id: requiredString(body.id, 'id') };
	if ('accountId' in body) input.accountId = nullableString(body.accountId, 'accountId');
	if ('categoryId' in body) input.categoryId = nullableString(body.categoryId, 'categoryId');
	if ('label' in body) input.label = nullableString(body.label, 'label');
	if ('counterparty' in body)
		input.counterparty = nullableString(body.counterparty, 'counterparty');
	if ('direction' in body) input.direction = enumValue(body.direction, directions, 'direction');
	if ('cadence' in body) input.cadence = enumValue(body.cadence, cadences, 'cadence');
	if ('amountCents' in body) input.amountCents = positiveInt(body.amountCents, 'amountCents');
	if ('nextDate' in body) input.nextDate = requireIsoDate(body.nextDate, 'nextDate');
	if ('endDate' in body) input.endDate = optionalIsoDate(body.endDate, 'endDate');
	if ('status' in body) input.status = enumValue(body.status, statuses, 'status');
	if ('note' in body) input.note = nullableString(body.note, 'note');
	if (Object.keys(input).length === 1)
		throw new ValidationError('At least one plan field must be updated');
	return input;
}
export function parseDeletePlanInput(value: unknown): { id: string } {
	return { id: requiredString(object(value).id, 'id') };
}
export function assertPlanDates(
	input: Pick<CreatePlanInput, 'cadence' | 'nextDate' | 'endDate'>
): void {
	if (input.cadence === 'once' && input.endDate)
		throw new ValidationError('Once plans cannot have an end date');
	if (input.endDate && input.endDate < input.nextDate)
		throw new ValidationError('endDate cannot be before nextDate');
}
function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new ValidationError('Request body must be a JSON object');
	return value as Record<string, unknown>;
}
function requiredString(value: unknown, field: string): string {
	if (typeof value !== 'string' || !value.trim()) throw new ValidationError(`${field} is required`);
	return value.trim();
}
function nullableString(value: unknown, field: string): string | null | undefined {
	if (value === undefined) return undefined;
	if (value === null || value === '') return null;
	return requiredString(value, field);
}
function positiveInt(value: unknown, field: string): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0)
		throw new ValidationError(`${field} must be a positive integer`);
	return value;
}
function nonNegativeInt(value: unknown, field: string): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 0)
		throw new ValidationError(`${field} must be a non-negative integer`);
	return value;
}
function enumValue<T extends string>(value: unknown, values: Set<T>, field: string): T {
	if (typeof value !== 'string' || !values.has(value as T))
		throw new ValidationError(`${field} is invalid`);
	return value as T;
}
function optionalEnum<T extends string>(
	value: unknown,
	values: Set<T>,
	field: string
): T | undefined {
	return value === undefined ? undefined : enumValue(value, values, field);
}
