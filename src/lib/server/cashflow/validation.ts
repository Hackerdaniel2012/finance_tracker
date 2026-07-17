import { ValidationError } from '../accounts/errors';
import type { CashflowWindow } from './types';

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export function parseCashflowWindow(url: URL, today = new Date()): CashflowWindow {
	const asOf = optionalDate(url.searchParams.get('asOf'), 'asOf') ?? toIsoDate(today);
	const nextIncomeDate = optionalDate(url.searchParams.get('nextIncomeDate'), 'nextIncomeDate') ?? null;
	const accountId = optionalQueryString(url, 'accountId');

	if (nextIncomeDate !== null && nextIncomeDate <= asOf) {
		throw new ValidationError('nextIncomeDate must be after asOf');
	}

	return {
		asOf,
		monthEnd: endOfMonth(asOf),
		nextIncomeDate,
		accountId
	};
}

function optionalQueryString(url: URL, field: string): string | undefined {
	const value = url.searchParams.get(field)?.trim();
	if (value === '') {
		throw new ValidationError(`${field} must not be empty`);
	}
	return value || undefined;
}

function optionalDate(value: string | null, field: string): string | undefined {
	if (value === null || value === '') {
		return undefined;
	}

	if (!isoDatePattern.test(value)) {
		throw new ValidationError(`${field} must be an ISO date`);
	}

	const parsed = new Date(`${value}T00:00:00.000Z`);
	if (Number.isNaN(parsed.getTime()) || toIsoDate(parsed) !== value) {
		throw new ValidationError(`${field} must be an ISO date`);
	}

	return value;
}

function endOfMonth(isoDate: string): string {
	const [year, month] = isoDate.split('-').map(Number);
	const date = new Date(Date.UTC(year, month, 0));
	return toIsoDate(date);
}

function toIsoDate(date: Date): string {
	return date.toISOString().slice(0, 10);
}
