import type { ParseError } from './types';

export interface ParsedCsv {
	headers: string[];
	records: CsvRecord[];
	errors: ParseError[];
}

export interface CsvRecord {
	rowNumber: number;
	values: Record<string, string>;
}

export function parseDelimitedCsv(
	input: string,
	options: { delimiter: ',' | ';'; headerRowIndex?: number }
): ParsedCsv {
	const lines = splitLines(input);
	const headerRowIndex = options.headerRowIndex ?? 0;
	const headerLine = lines[headerRowIndex];

	if (!headerLine) {
		return {
			headers: [],
			records: [],
			errors: [{ rowNumber: 1, code: 'missing_header', message: 'CSV header row is missing' }]
		};
	}

	const headers = parseCsvLine(headerLine, options.delimiter).map((header) => header.trim());
	const records: CsvRecord[] = [];
	const errors: ParseError[] = [];

	for (let index = headerRowIndex + 1; index < lines.length; index += 1) {
		const line = lines[index];
		const rowNumber = index + 1;

		if (line.trim() === '') {
			continue;
		}

		const cells = parseCsvLine(line, options.delimiter);
		if (cells.length !== headers.length) {
			errors.push({
				rowNumber,
				code: 'column_count_mismatch',
				message: `Expected ${headers.length} columns but found ${cells.length}`
			});
			continue;
		}

		records.push({
			rowNumber,
			values: Object.fromEntries(
				headers.map((header, cellIndex) => [header, cells[cellIndex]?.trim() ?? ''])
			)
		});
	}

	return { headers, records, errors };
}

export function splitLines(input: string): string[] {
	return input
		.replace(/^\uFEFF/, '')
		.replace(/\r\n/g, '\n')
		.replace(/\r/g, '\n')
		.split('\n');
}

export function parseCsvLine(line: string, delimiter: ',' | ';'): string[] {
	const cells: string[] = [];
	let current = '';
	let inQuotes = false;

	for (let index = 0; index < line.length; index += 1) {
		const char = line[index];
		const next = line[index + 1];

		if (char === '"' && inQuotes && next === '"') {
			current += '"';
			index += 1;
			continue;
		}

		if (char === '"') {
			inQuotes = !inQuotes;
			continue;
		}

		if (char === delimiter && !inQuotes) {
			cells.push(current);
			current = '';
			continue;
		}

		current += char;
	}

	cells.push(current);
	return cells;
}

export function findHeaderRow(input: string, firstHeader: string, delimiter: ',' | ';'): number {
	const lines = splitLines(input);

	return lines.findIndex((line) => parseCsvLine(line, delimiter)[0]?.trim() === firstHeader);
}

export function missingRequiredColumns(headers: string[], requiredColumns: string[]): string[] {
	const headerSet = new Set(headers);
	return requiredColumns.filter((column) => !headerSet.has(column));
}
