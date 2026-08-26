import type { BankId, NormalizedTransaction } from '$lib/banks';
import type { DbClient, DbRow } from '../db-client';

const lookupChunkSize = 50;

export interface ExistingDuplicateTransaction {
	id: string;
	bookingDate: string;
	valueDate: string | null;
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

type DkbBankId = Extract<BankId, 'dkb_girocard' | 'dkb_creditcard'>;

export interface DkbSemanticDuplicateOptions {
	adapterId: DkbBankId;
	candidates: ExistingDuplicateTransaction[];
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
				`SELECT id, booking_date, value_date, amount_cents, payee, description, dedupe_key
				FROM transactions
				WHERE account_id = ?
					AND dedupe_key IN (${placeholders})`
			)
			.bind(accountId, ...chunk)
			.all<ExistingTransactionRow>();

		for (const row of results) {
			existingTransactions.set(row.dedupe_key, {
				id: row.id,
				bookingDate: row.booking_date,
				valueDate: row.value_date,
				amountCents: row.amount_cents,
				payee: row.payee,
				description: row.description,
				dedupeKey: row.dedupe_key
			});
		}
	}

	return existingTransactions;
}

export async function getDkbSemanticDuplicateCandidates(
	db: DbClient,
	adapterId: DkbBankId,
	accountId: string,
	startDate: string,
	endDate: string
): Promise<ExistingDuplicateTransaction[]> {
	const bookingDateMarginDays = adapterId === 'dkb_creditcard' ? 2 : 1;
	const { results } = await db
		.prepare(
			`SELECT id, booking_date, value_date, amount_cents, payee, description, dedupe_key
			FROM transactions
			WHERE account_id = ?
				AND booking_date BETWEEN ? AND ?`
		)
		.bind(
			accountId,
			shiftIsoDate(startDate, -bookingDateMarginDays),
			shiftIsoDate(endDate, bookingDateMarginDays)
		)
		.all<ExistingTransactionRow>();

	return results.map((row) => ({
		id: row.id,
		bookingDate: row.booking_date,
		valueDate: row.value_date,
		amountCents: row.amount_cents,
		payee: row.payee,
		description: row.description,
		dedupeKey: row.dedupe_key
	}));
}

export function partitionImportRows(
	rows: NormalizedTransaction[],
	existingTransactions: Map<string, ExistingDuplicateTransaction>,
	semantic?: DkbSemanticDuplicateOptions
): { rows: NormalizedTransaction[]; duplicates: DuplicateImportRow[] } {
	const seenKeys = new Set<string>();
	const usedExistingIds = new Set<string>();
	const decisions = new Map<number, DuplicateImportRow | null>();
	const unmatchedRows: Array<{ index: number; transaction: NormalizedTransaction }> = [];

	for (const [index, row] of rows.entries()) {
		const existingTransaction = existingTransactions.get(row.dedupeKey);
		if (existingTransaction) {
			usedExistingIds.add(existingTransaction.id);
			decisions.set(index, {
				transaction: row,
				reason: 'existing_transaction',
				existingTransaction
			});
			continue;
		}

		if (seenKeys.has(row.dedupeKey)) {
			decisions.set(index, { transaction: row, reason: 'duplicate_in_file' });
			continue;
		}

		seenKeys.add(row.dedupeKey);
		unmatchedRows.push({ index, transaction: row });
	}

	const semanticEdges = unmatchedRows
		.flatMap((incoming) =>
			(semantic?.candidates ?? [])
				.filter((candidate) => !usedExistingIds.has(candidate.id))
				.map((candidate) => ({
					incoming,
					candidate,
					score: getDkbSemanticMatchScore(
						semantic!.adapterId,
						incoming.transaction,
						candidate
					)
				}))
				.filter((edge) => edge.score > 0)
		)
		.sort(
			(left, right) =>
				right.score - left.score ||
				left.incoming.index - right.incoming.index ||
				left.candidate.id.localeCompare(right.candidate.id)
		);
	const matchedIncomingIndexes = new Set<number>();
	for (const edge of semanticEdges) {
		if (
			matchedIncomingIndexes.has(edge.incoming.index) ||
			usedExistingIds.has(edge.candidate.id)
		) {
			continue;
		}

		matchedIncomingIndexes.add(edge.incoming.index);
		usedExistingIds.add(edge.candidate.id);
		decisions.set(edge.incoming.index, {
			transaction: edge.incoming.transaction,
			reason: 'existing_transaction',
			existingTransaction: edge.candidate
		});
	}

	const insertableRows: NormalizedTransaction[] = [];
	const duplicates: DuplicateImportRow[] = [];
	for (const [index, row] of rows.entries()) {
		const decision = decisions.get(index);
		if (decision) duplicates.push(decision);
		else insertableRows.push(row);
	}

	return { rows: insertableRows, duplicates };
}

function getDkbSemanticMatchScore(
	adapterId: DkbBankId,
	incoming: NormalizedTransaction,
	existing: ExistingDuplicateTransaction
): number {
	if (
		(incoming.valueDate ?? null) !== existing.valueDate ||
		incoming.amountCents !== existing.amountCents
	) {
		return 0;
	}

	const incomingDescription = normalizeDkbDescription(incoming.description);
	const existingDescription = normalizeDkbDescription(existing.description);
	if (!incomingDescription || !existingDescription) return 0;
	const bookingDateDifference = getDateDifferenceInDays(
		incoming.bookingDate,
		existing.bookingDate
	);
	if (adapterId === 'dkb_creditcard') {
		return incomingDescription === existingDescription && bookingDateDifference <= 2
			? 3 - bookingDateDifference
			: 0;
	}
	if (incoming.bookingDate !== existing.bookingDate) {
		return incoming.valueDate &&
			incomingDescription === existingDescription &&
			bookingDateDifference <= 1
			? 1
			: 0;
	}
	if (incomingDescription === existingDescription) return 3;

	const shorter =
		incomingDescription.length <= existingDescription.length
			? incomingDescription
			: existingDescription;
	const longer =
		incomingDescription.length > existingDescription.length
			? incomingDescription
			: existingDescription;
	if (shorter.length >= 24 && shorter.length / longer.length >= 0.6 && longer.includes(shorter)) {
		return 2;
	}

	return 0;
}

function getDateDifferenceInDays(left: string, right: string): number {
	return Math.abs(Date.parse(`${left}T00:00:00Z`) - Date.parse(`${right}T00:00:00Z`)) / 86_400_000;
}

function shiftIsoDate(value: string, days: number): string {
	const date = new Date(`${value}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

function normalizeDkbDescription(value: string | null | undefined): string {
	return (value ?? '')
		.normalize('NFKC')
		.toLocaleLowerCase('de-DE')
		.replace(/\b(?:eingang|ausgang)\b/gu, ' ')
		.replace(/\b[a-z]{2}\d{2}[a-z0-9]{11,30}\b/giu, ' ')
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

interface ExistingTransactionRow extends DbRow {
	id: string;
	booking_date: string;
	value_date: string | null;
	amount_cents: number;
	payee: string | null;
	description: string | null;
	dedupe_key: string;
}
