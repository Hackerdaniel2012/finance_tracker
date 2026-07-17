import { ValidationError } from '../accounts/errors';
import type { NetWorthReportOptions, ReportDateRange, SummaryReportOptions } from './types';

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export function parseReportDateRange(url: URL, today = new Date()): ReportDateRange {
	const from =
		optionalDate(url.searchParams.get('from'), 'from') ?? startOfMonth(monthsAgo(today, 11));
	const to = optionalDate(url.searchParams.get('to'), 'to') ?? toIsoDate(today);

	if (from > to) {
		throw new ValidationError('from must be before or equal to to');
	}

	return { from, to };
}

export function parseNetWorthReportOptions(url: URL): NetWorthReportOptions {
	return {
		accountId: optionalQueryString(url, 'accountId')
	};
}

export function parseSummaryReportOptions(url: URL): SummaryReportOptions {
	return {
		accountId: optionalQueryString(url, 'accountId')
	};
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

function optionalQueryString(url: URL, field: string): string | undefined {
	const value = url.searchParams.get(field)?.trim();
	return value || undefined;
}

function startOfMonth(date: Date): string {
	return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function monthsAgo(date: Date, months: number): Date {
	return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - months, 1));
}

function toIsoDate(date: Date): string {
	return date.toISOString().slice(0, 10);
}
