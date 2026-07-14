import { getBankAdapter, type BankId } from '$lib/banks';
import type { DbClient } from '../db-client';
import { NotFoundError, ValidationError } from '../accounts/errors';
import { getAccount } from '../accounts/repository';
import { getDateRange, sha256Hex } from './shared';
import { getExistingTransactionsByDedupeKey, partitionImportRows } from './deduplication';
import type { ImportPreview, ImportPreviewInput } from './types';

const sampleRowLimit = 5;

export async function previewImport(
	db: DbClient,
	input: ImportPreviewInput
): Promise<ImportPreview> {
	const accountId = input.accountId.trim();
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
	const { startDate, endDate } = getDateRange(parsed.rows.map((row) => row.bookingDate));

	return {
		accountId: account.id,
		adapterId: adapter.id,
		fileHash: await sha256Hex(input.csv),
		summary: {
			parsedRows: parsed.rows.length,
			skippedRows: parsed.skippedRows,
			errorCount: parsed.errors.length,
			duplicateEstimate: partition.duplicates.length,
			startDate,
			endDate
		},
		metadata: parsed.metadata ?? {},
		sampleRows: parsed.rows.slice(0, sampleRowLimit),
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
