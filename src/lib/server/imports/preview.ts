import { getBankAdapter, type BankId } from '$lib/banks';
import type { DbClient, DbRow } from '../db-client';
import { NotFoundError, ValidationError } from '../accounts/errors';
import { getAccount } from '../accounts/repository';
import { getDateRange, sha256Hex } from './shared';
import type { ImportPreview, ImportPreviewInput } from './types';

const sampleRowLimit = 5;
const duplicateEstimateChunkSize = 50;

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
	const duplicateEstimate = await countExistingTransactions(
		db,
		account.id,
		parsed.rows.map((row) => row.dedupeKey)
	);
	const { startDate, endDate } = getDateRange(parsed.rows.map((row) => row.bookingDate));

	return {
		accountId: account.id,
		adapterId: adapter.id,
		fileHash: await sha256Hex(input.csv),
		summary: {
			parsedRows: parsed.rows.length,
			skippedRows: parsed.skippedRows,
			errorCount: parsed.errors.length,
			duplicateEstimate,
			startDate,
			endDate
		},
		metadata: parsed.metadata ?? {},
		sampleRows: parsed.rows.slice(0, sampleRowLimit),
		errors: parsed.errors
	};
}

async function countExistingTransactions(
	db: DbClient,
	accountId: string,
	dedupeKeys: string[]
): Promise<number> {
	const uniqueKeys = [...new Set(dedupeKeys)];
	if (uniqueKeys.length === 0) {
		return 0;
	}

	let count = 0;
	for (let index = 0; index < uniqueKeys.length; index += duplicateEstimateChunkSize) {
		const chunk = uniqueKeys.slice(index, index + duplicateEstimateChunkSize);
		const placeholders = chunk.map(() => '?').join(', ');
		const row = await db
			.prepare(
				`SELECT COUNT(*) AS count
				FROM transactions
				WHERE account_id = ?
					AND dedupe_key IN (${placeholders})`
			)
			.bind(accountId, ...chunk)
			.first<CountRow>();
		count += Number(row?.count ?? 0);
	}

	return count;
}

function getAdapter(adapterId: string) {
	try {
		return getBankAdapter(adapterId as BankId);
	} catch {
		throw new ValidationError('adapterId is invalid');
	}
}

interface CountRow extends DbRow {
	count: number;
}
