import {
	getBankAdapter,
	type BankId,
	type NormalizedTransaction,
	type ParseError
} from '$lib/banks';
import { ConflictError, NotFoundError, ValidationError } from '../accounts/errors';
import { getAccount } from '../accounts/repository';
import { listCategoryRules } from '../categories/repository';
import type { CategoryRule } from '../categories/types';
import { matchesCategoryRule } from '../categories/matcher';
import type { DbClient, DbRow, DbStatement } from '../db-client';
import { generateRecurringSuggestions } from '../recurring/repository';
import { getDateRange, sha256Hex } from './shared';
import type { ConfirmImportInput, ImportReport } from './types';

const dedupeLookupChunkSize = 50;

export async function confirmImport(
	db: DbClient,
	input: ConfirmImportInput
): Promise<ImportReport> {
	const accountId = input.accountId.trim();
	if (!accountId) {
		throw new ValidationError('accountId is required');
	}

	if (!input.csv.trim()) {
		throw new ValidationError('CSV file is required');
	}

	const expectedHash = input.expectedHash.trim();
	if (!expectedHash) {
		throw new ValidationError('expectedHash is required');
	}

	const fileHash = await sha256Hex(input.csv);
	if (fileHash !== expectedHash) {
		throw new ValidationError('File hash does not match preview');
	}

	const account = await getAccount(db, accountId);
	if (!account) {
		throw new NotFoundError('Account not found');
	}

	const adapter = getAdapter(input.adapterId);
	const parsed = adapter.parse(input.csv);
	const { startDate, endDate } = getDateRange(parsed.rows.map((row) => row.bookingDate));
	const batchId = crypto.randomUUID();
	await assertNewFileHash(db, account.id, fileHash);
	const insertableRows = await selectInsertableRows(db, account.id, parsed.rows);
	const rules = await listCategoryRules(db);
	let unknownCount = 0;

	const writeStatements: DbStatement[] = [
		createBatchStatement(db, {
			batchId,
			accountId: account.id,
			fileHash,
			adapterId: adapter.id,
			startDate,
			endDate,
			rowCount: parsed.rows.length,
			importedCount: insertableRows.rows.length,
			duplicateCount: insertableRows.duplicateCount,
			errorCount: parsed.errors.length
		})
	];

	for (const row of insertableRows.rows) {
		const match = matchCategoryRule(row, rules);
		const transactionId = crypto.randomUUID();
		const classificationStatus = match ? 'auto' : 'unknown';

		if (!match) {
			unknownCount += 1;
		}

		writeStatements.push(
			insertTransactionStatement(db, {
				transactionId,
				accountId: account.id,
				batchId,
				categoryId: match?.categoryId ?? null,
				classificationStatus,
				row
			})
		);

		if (!match) {
			writeStatements.push(insertReviewFlagStatement(db, transactionId));
		}
	}

	for (const error of parsed.errors) {
		writeStatements.push(insertRowErrorStatement(db, batchId, error));
	}

	await runImportWriteBatch(db, writeStatements);
	await generateRecurringSuggestions(db);

	return {
		batchId,
		accountId: account.id,
		adapterId: adapter.id,
		fileHash,
		startDate,
		endDate,
		rowCount: parsed.rows.length,
		importedCount: insertableRows.rows.length,
		duplicateCount: insertableRows.duplicateCount,
		errorCount: parsed.errors.length,
		unknownCount
	};
}

async function runImportWriteBatch(db: DbClient, statements: DbStatement[]): Promise<void> {
	if (statements.length === 0) {
		return;
	}

	if (!db.batch) {
		throw new Error('Database batch support is required for atomic import confirmation');
	}

	await db.batch(statements);
}

async function assertNewFileHash(db: DbClient, accountId: string, fileHash: string): Promise<void> {
	const existing = await db
		.prepare(
			`SELECT id
			FROM import_batches
			WHERE account_id = ?
				AND file_hash = ?`
		)
		.bind(accountId, fileHash)
		.first<IdRow>();

	if (existing) {
		throw new ConflictError('Import batch already exists for this account and file');
	}
}

async function selectInsertableRows(
	db: DbClient,
	accountId: string,
	rows: NormalizedTransaction[]
): Promise<{ rows: NormalizedTransaction[]; duplicateCount: number }> {
	const existingKeys = await getExistingDedupeKeys(
		db,
		accountId,
		rows.map((row) => row.dedupeKey)
	);
	const seenKeys = new Set<string>();
	const insertableRows: NormalizedTransaction[] = [];
	let duplicateCount = 0;

	for (const row of rows) {
		if (existingKeys.has(row.dedupeKey) || seenKeys.has(row.dedupeKey)) {
			duplicateCount += 1;
			continue;
		}

		seenKeys.add(row.dedupeKey);
		insertableRows.push(row);
	}

	return { rows: insertableRows, duplicateCount };
}

async function getExistingDedupeKeys(
	db: DbClient,
	accountId: string,
	dedupeKeys: string[]
): Promise<Set<string>> {
	const uniqueKeys = [...new Set(dedupeKeys)];
	if (uniqueKeys.length === 0) {
		return new Set();
	}

	const existingKeys = new Set<string>();
	for (let index = 0; index < uniqueKeys.length; index += dedupeLookupChunkSize) {
		const chunk = uniqueKeys.slice(index, index + dedupeLookupChunkSize);
		const placeholders = chunk.map(() => '?').join(', ');
		const { results } = await db
			.prepare(
				`SELECT dedupe_key
				FROM transactions
				WHERE account_id = ?
					AND dedupe_key IN (${placeholders})`
			)
			.bind(accountId, ...chunk)
			.all<DedupeRow>();

		for (const row of results) {
			existingKeys.add(row.dedupe_key);
		}
	}

	return existingKeys;
}

function createBatchStatement(
	db: DbClient,
	input: {
		batchId: string;
		accountId: string;
		fileHash: string;
		adapterId: string;
		startDate: string | null;
		endDate: string | null;
		rowCount: number;
		importedCount: number;
		duplicateCount: number;
		errorCount: number;
	}
): DbStatement {
	return db
		.prepare(
			`INSERT INTO import_batches (
				id, account_id, file_hash, adapter_id, start_date, end_date,
				row_count, imported_count, duplicate_count, error_count
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			input.batchId,
			input.accountId,
			input.fileHash,
			input.adapterId,
			input.startDate,
			input.endDate,
			input.rowCount,
			input.importedCount,
			input.duplicateCount,
			input.errorCount
		);
}

function insertTransactionStatement(
	db: DbClient,
	input: {
		transactionId: string;
		accountId: string;
		batchId: string;
		categoryId: string | null;
		classificationStatus: 'auto' | 'unknown';
		row: NormalizedTransaction;
	}
): DbStatement {
	return db
		.prepare(
			`INSERT INTO transactions (
				id, account_id, import_batch_id, category_id, dedupe_key,
				booking_date, value_date, amount_cents, currency, original_amount_cents,
				original_currency, exchange_rate, balance_after_cents, payee, description,
				note, search_text, classification_status, subaccount
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			input.transactionId,
			input.accountId,
			input.batchId,
			input.categoryId,
			input.row.dedupeKey,
			input.row.bookingDate,
			input.row.valueDate ?? null,
			input.row.amountCents,
			input.row.currency,
			input.row.originalAmountCents ?? null,
			input.row.originalCurrency ?? null,
			input.row.exchangeRate ?? null,
			input.row.balanceAfterCents ?? null,
			input.row.payee ?? null,
			input.row.description ?? null,
			input.row.note ?? null,
			input.row.searchText,
			input.classificationStatus,
			input.row.source.subaccount ?? null
		);
}

function insertReviewFlagStatement(db: DbClient, transactionId: string): DbStatement {
	return db
		.prepare(
			`INSERT INTO transaction_review_flags (id, transaction_id, reason)
			VALUES (?, ?, ?)`
		)
		.bind(crypto.randomUUID(), transactionId, 'unknown_category');
}

function insertRowErrorStatement(db: DbClient, batchId: string, error: ParseError): DbStatement {
	return db
		.prepare(
			`INSERT INTO import_row_errors (id, import_batch_id, row_number, code, message)
			VALUES (?, ?, ?, ?, ?)`
		)
		.bind(crypto.randomUUID(), batchId, error.rowNumber, error.code, error.message);
}

function getAdapter(adapterId: string) {
	try {
		return getBankAdapter(adapterId as BankId);
	} catch {
		throw new ValidationError('adapterId is invalid');
	}
}

function matchCategoryRule(
	row: NormalizedTransaction,
	rules: CategoryRule[]
): CategoryRule | undefined {
	return rules.find((rule) =>
		matchesCategoryRule(
			{
				payee: row.payee ?? null,
				description: row.description ?? null,
				note: row.note ?? null,
				searchText: row.searchText
			},
			rule
		)
	);
}

interface DedupeRow extends DbRow {
	dedupe_key: string;
}

interface IdRow extends DbRow {
	id: string;
}
