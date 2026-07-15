import type { NormalizedTransaction } from '$lib/banks';
import { ValidationError } from '../accounts/errors';
import { optionalIsoDate } from '../date-validation';
import type { CombinedImportRow } from './types';

export interface CombinedImportGroup extends CombinedImportRow {
	dedupeKeys: string[];
}

export interface CombinedImportPartition {
	detailedRows: NormalizedTransaction[];
	combinedGroups: CombinedImportGroup[];
	combinedSourceCount: number;
}

export function parseCombineBeforeDate(value: unknown): string | null {
	const date = optionalIsoDate(value, 'combineBeforeDate') ?? null;
	if (date && date > new Date().toISOString().slice(0, 10)) {
		throw new ValidationError('combineBeforeDate cannot be in the future');
	}
	return date;
}

export function combineImportRows(
	rows: NormalizedTransaction[],
	combineBeforeDate: string | null
): CombinedImportPartition {
	if (!combineBeforeDate) {
		return { detailedRows: rows, combinedGroups: [], combinedSourceCount: 0 };
	}

	const detailedRows: NormalizedTransaction[] = [];
	const groups = new Map<string, CombinedImportGroup>();
	const bookingDate = previousDate(combineBeforeDate);

	for (const row of rows) {
		if (row.bookingDate >= combineBeforeDate) {
			detailedRows.push(row);
			continue;
		}

		const subaccount = row.source.subaccount?.trim() || null;
		const key = subaccount ?? '\u0000';
		const group = groups.get(key) ?? {
			subaccount,
			bookingDate,
			amountCents: 0,
			sourceRowCount: 0,
			dedupeKeys: []
		};
		group.amountCents += row.amountCents;
		group.sourceRowCount += 1;
		group.dedupeKeys.push(row.dedupeKey);
		groups.set(key, group);
	}

	const combinedGroups = [...groups.values()].sort((left, right) =>
		(left.subaccount ?? '').localeCompare(right.subaccount ?? '')
	);
	return {
		detailedRows,
		combinedGroups,
		combinedSourceCount: combinedGroups.reduce((sum, group) => sum + group.sourceRowCount, 0)
	};
}

function previousDate(date: string): string {
	const value = new Date(`${date}T00:00:00.000Z`);
	value.setUTCDate(value.getUTCDate() - 1);
	return value.toISOString().slice(0, 10);
}
