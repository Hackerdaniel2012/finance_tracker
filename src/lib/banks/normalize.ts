import type { NormalizedTransaction, ParseError } from './types';

export function parseIsoDate(value: string): string | undefined {
	const trimmed = value.trim();

	if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
		return undefined;
	}

	const date = new Date(`${trimmed}T00:00:00.000Z`);
	return isSameUtcDate(date, trimmed) ? trimmed : undefined;
}

export function parseGermanShortDate(value: string): string | undefined {
	const match = /^(\d{2})\.(\d{2})\.(\d{2})$/.exec(value.trim());
	if (!match) {
		return undefined;
	}

	const [, day, month, year] = match;
	const isoDate = `20${year}-${month}-${day}`;
	const date = new Date(`${isoDate}T00:00:00.000Z`);

	return isSameUtcDate(date, isoDate) ? isoDate : undefined;
}

export function parseEuroCents(value: string): number | undefined {
	const compact = value
		.trim()
		.replace(/\s/g, '')
		.replace(/\u00a0/g, '')
		.replace(/€/g, '');
	const normalized = compact.includes(',') ? compact.replace(/\./g, '').replace(',', '.') : compact;

	if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
		return undefined;
	}

	return Math.round(Number(normalized) * 100);
}

export function parseOptionalEuroCents(value: string | undefined): number | undefined {
	if (!value?.trim()) {
		return undefined;
	}

	return parseEuroCents(value);
}

export function normalizeWhitespace(...parts: Array<string | undefined>): string {
	return parts
		.map((part) => part?.trim())
		.filter((part): part is string => Boolean(part))
		.join(' ')
		.replace(/\s+/g, ' ')
		.trim();
}

export function stableFingerprint(parts: Array<string | number | undefined>): string {
	const input = parts
		.map((part) =>
			String(part ?? '')
				.trim()
				.toLowerCase()
				.replace(/\s+/g, ' ')
		)
		.join('|');

	let hash = 0x811c9dc5;
	for (let index = 0; index < input.length; index += 1) {
		hash ^= input.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}

	return `fp_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function makeParseError(rowNumber: number, code: string, message: string): ParseError {
	return { rowNumber, code, message };
}

export function dateRange(rows: NormalizedTransaction[]): { startDate?: string; endDate?: string } {
	if (rows.length === 0) {
		return {};
	}

	const dates = rows.map((row) => row.bookingDate).sort();
	return { startDate: dates[0], endDate: dates[dates.length - 1] };
}

function isSameUtcDate(date: Date, isoDate: string): boolean {
	if (Number.isNaN(date.getTime())) {
		return false;
	}

	return date.toISOString().slice(0, 10) === isoDate;
}
