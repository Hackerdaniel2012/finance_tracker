import type { NormalizedTransaction } from '$lib/banks';
import type { DbClient, DbRow } from '../db-client';

const lookupChunkSize = 50;

export interface ExistingDuplicateTransaction {
	bookingDate: string;
	amountCents: number;
	payee: string | null;
	description: string | null;
	dedupeKey: string;
}

export interface DuplicateImportRow {
	transaction: NormalizedTransaction;
	reason: 'existing_transaction' | 'duplicate_in_file';
	existingTransaction?: ExistingDuplicateTransaction;
}

export async function getExistingTransactionsByDedupeKey(
	db: DbClient,
	accountId: string,
	dedupeKeys: string[]
): Promise<Map<string, ExistingDuplicateTransaction>> {
	const uniqueKeys = [...new Set(dedupeKeys)];
	const existingTransactions = new Map<string, ExistingDuplicateTransaction>();

	for (let index = 0; index < uniqueKeys.length; index += lookupChunkSize) {
		const chunk = uniqueKeys.slice(index, index + lookupChunkSize);
		const placeholders = chunk.map(() => '?').join(', ');
		const { results } = await db
			.prepare(
				`SELECT booking_date, amount_cents, payee, description, dedupe_key
				FROM transactions
				WHERE account_id = ?
					AND dedupe_key IN (${placeholders})`
			)
			.bind(accountId, ...chunk)
			.all<ExistingTransactionRow>();

		for (const row of results) {
			existingTransactions.set(row.dedupe_key, {
				bookingDate: row.booking_date,
				amountCents: row.amount_cents,
				payee: row.payee,
				description: row.description,
				dedupeKey: row.dedupe_key
			});
		}
	}

	return existingTransactions;
}

export function partitionImportRows(
	rows: NormalizedTransaction[],
	existingTransactions: Map<string, ExistingDuplicateTransaction>
): { rows: NormalizedTransaction[]; duplicates: DuplicateImportRow[] } {
	const seenKeys = new Set<string>();
	const insertableRows: NormalizedTransaction[] = [];
	const duplicates: DuplicateImportRow[] = [];

	for (const row of rows) {
		const existingTransaction = existingTransactions.get(row.dedupeKey);
		if (existingTransaction) {
			duplicates.push({ transaction: row, reason: 'existing_transaction', existingTransaction });
			continue;
		}

		if (seenKeys.has(row.dedupeKey)) {
			duplicates.push({ transaction: row, reason: 'duplicate_in_file' });
			continue;
		}

		seenKeys.add(row.dedupeKey);
		insertableRows.push(row);
	}

	return { rows: insertableRows, duplicates };
}

interface ExistingTransactionRow extends DbRow {
	booking_date: string;
	amount_cents: number;
	payee: string | null;
	description: string | null;
	dedupe_key: string;
}
