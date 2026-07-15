import { getBankAdapter, type BankId } from '$lib/banks';
import type { DbClient } from '../db-client';
import { NotFoundError, ValidationError } from '../accounts/errors';
import { getAccount } from '../accounts/repository';
import { getDateRange, sha256Hex } from './shared';
import { getExistingTransactionsByDedupeKey, partitionImportRows } from './deduplication';
import type { ImportPreview, ImportPreviewInput } from './types';
import { combineImportRows, parseCombineBeforeDate } from './combination';

const sampleRowLimit = 5;

export async function previewImport(
	db: DbClient,
	input: ImportPreviewInput
): Promise<ImportPreview> {
	const accountId = input.accountId.trim();
	const combineBeforeDate = parseCombineBeforeDate(input.combineBeforeDate);
	if (!accountId) {
		throw new ValidationError('accountId is required');
	}

	if (!input.csv.trim()) {
		throw new ValidationError('CSV file is required');
	}

	const account = await getAccount(db, accountId);
	if (!account) {
		throw new NotFoundError('Account not found');
	}

	const adapter = getAdapter(input.adapterId);
	const parsed = adapter.parse(input.csv);
	const existingTransactions = await getExistingTransactionsByDedupeKey(
		db,
		account.id,
		parsed.rows.map((row) => row.dedupeKey)
	);
	const partition = partitionImportRows(parsed.rows, existingTransactions);
	const combination = combineImportRows(partition.rows, combineBeforeDate);
	const { startDate, endDate } = getDateRange(parsed.rows.map((row) => row.bookingDate));

	return {
		accountId: account.id,
		adapterId: adapter.id,
		fileHash: await sha256Hex(input.csv),
		combineBeforeDate,
		summary: {
			parsedRows: parsed.rows.length,
			skippedRows: parsed.skippedRows,
			errorCount: parsed.errors.length,
			duplicateEstimate: partition.duplicates.length,
			startDate,
			endDate,
			combinedSourceCount: combination.combinedSourceCount,
			combinedRecordCount: combination.combinedGroups.length,
			detailedImportCount: combination.detailedRows.length,
			effectiveImportCount: combination.detailedRows.length + combination.combinedGroups.length
		},
		metadata: parsed.metadata ?? {},
		sampleRows: combination.detailedRows.slice(0, sampleRowLimit),
		combinedRows: combination.combinedGroups.map((group) => ({
			subaccount: group.subaccount,
			bookingDate: group.bookingDate,
			amountCents: group.amountCents,
			sourceRowCount: group.sourceRowCount
		})),
		duplicateRows: partition.duplicates,
		errors: parsed.errors
	};
}

function getAdapter(adapterId: string) {
	try {
		return getBankAdapter(adapterId as BankId);
	} catch {
		throw new ValidationError('adapterId is invalid');
	}
}
