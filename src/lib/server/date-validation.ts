import { ValidationError } from './accounts/errors';

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

/** Parses a calendar date without JavaScript's permissive date rollover. */
export function requireIsoDate(value: unknown, field: string): string {
	if (typeof value !== 'string' || !value.trim()) throw new ValidationError(`${field} is required`);
	const date = value.trim();
	const parsed = new Date(`${date}T00:00:00.000Z`);
	if (!isoDate.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date)
		throw new ValidationError(`${field} must be an ISO date`);
	return date;
}

export function optionalIsoDate(value: unknown, field: string): string | null | undefined {
	if (value === undefined) return undefined;
	if (value === null || value === '') return null;
	return requireIsoDate(value, field);
}
