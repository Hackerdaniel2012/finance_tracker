import { ValidationError } from '../accounts/errors';
import type { ReportDateRange } from './types';

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export function parseReportDateRange(url: URL, today = new Date()): ReportDateRange {
	const from = optionalDate(url.searchParams.get('from'), 'from') ?? startOfMonth(today);
	const to = optionalDate(url.searchParams.get('to'), 'to') ?? toIsoDate(today);

	if (from > to) {
		throw new ValidationError('from must be before or equal to to');
	}

	return { from, to };
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

function startOfMonth(date: Date): string {
	return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function toIsoDate(date: Date): string {
	return date.toISOString().slice(0, 10);
}
