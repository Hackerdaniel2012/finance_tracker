import { getBankAdapter, type NormalizedTransaction, type ParseError } from '$lib/banks';
import { ConflictError, NotFoundError, ValidationError } from '../accounts/errors';
import { getProfile } from '../accounts/repository';
import { listCategoryRules } from '../categories/repository';
import type { CategoryRule } from '../categories/types';
import type { DbClient, DbRow } from '../db-client';
import { getDateRange, sha256Hex } from './shared';
import type { ConfirmImportInput, ImportReport } from './types';

const dedupeLookupChunkSize = 50;

export async function confirmImport(
	db: DbClient,
	input: ConfirmImportInput
): Promise<ImportReport> {
	const profileId = input.profileId.trim();
	if (!profileId) {
		throw new ValidationError('profileId is required');
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

	const profile = await getProfile(db, profileId);
	if (!profile) {
		throw new NotFoundError('Import profile not found');
	}

	const adapter = getBankAdapter(profile.bankId);
	const parsed = adapter.parse(input.csv);
	const { startDate, endDate } = getDateRange(parsed.rows.map((row) => row.bookingDate));
	const batchId = crypto.randomUUID();
	await assertNewFileHash(db, profile.id, fileHash);
	const insertableRows = await selectInsertableRows(db, profile.id, parsed.rows);
	const rules = await listCategoryRules(db);
	let unknownCount = 0;

	await createBatch(db, {
		batchId,
		profileId: profile.id,
		fileHash,
		adapterId: adapter.id,
		startDate,
		endDate,
		rowCount: parsed.rows.length,
		importedCount: insertableRows.rows.length,
		duplicateCount: insertableRows.duplicateCount,
		errorCount: parsed.errors.length
	});

	for (const row of insertableRows.rows) {
		const match = matchCategoryRule(row, rules);
		const transactionId = crypto.randomUUID();
		const classificationStatus = match ? 'auto' : 'unknown';

		if (!match) {
			unknownCount += 1;
		}

		await insertTransaction(db, {
			transactionId,
			profileId: profile.id,
			accountId: profile.accountId,
			batchId,
			categoryId: match?.categoryId ?? null,
			classificationStatus,
			row
		});

		if (!match) {
			await insertReviewFlag(db, transactionId);
		}
	}

	for (const error of parsed.errors) {
		await insertRowError(db, batchId, profile.id, error);
	}

	return {
		batchId,
		profileId: profile.id,
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

async function assertNewFileHash(db: DbClient, profileId: string, fileHash: string): Promise<void> {
	const existing = await db
		.prepare(
			`SELECT id
			FROM import_batches
			WHERE profile_id = ?
				AND file_hash = ?`
		)
		.bind(profileId, fileHash)
		.first<IdRow>();

	if (existing) {
		throw new ConflictError('Import batch already exists for this profile and file');
	}
}

async function selectInsertableRows(
	db: DbClient,
	profileId: string,
	rows: NormalizedTransaction[]
): Promise<{ rows: NormalizedTransaction[]; duplicateCount: number }> {
	const existingKeys = await getExistingDedupeKeys(
		db,
		profileId,
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
	profileId: string,
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
				WHERE profile_id = ?
					AND dedupe_key IN (${placeholders})`
			)
			.bind(profileId, ...chunk)
			.all<DedupeRow>();

		for (const row of results) {
			existingKeys.add(row.dedupe_key);
		}
	}

	return existingKeys;
}

async function createBatch(
	db: DbClient,
	input: {
		batchId: string;
		profileId: string;
		fileHash: string;
		adapterId: string;
		startDate: string | null;
		endDate: string | null;
		rowCount: number;
		importedCount: number;
		duplicateCount: number;
		errorCount: number;
	}
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO import_batches (
				id, profile_id, file_hash, adapter_id, start_date, end_date,
				row_count, imported_count, duplicate_count, error_count
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			input.batchId,
			input.profileId,
			input.fileHash,
			input.adapterId,
			input.startDate,
			input.endDate,
			input.rowCount,
			input.importedCount,
			input.duplicateCount,
			input.errorCount
		)
		.run();
}

async function insertTransaction(
	db: DbClient,
	input: {
		transactionId: string;
		profileId: string;
		accountId: string;
		batchId: string;
		categoryId: string | null;
		classificationStatus: 'auto' | 'unknown';
		row: NormalizedTransaction;
	}
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO transactions (
				id, profile_id, account_id, import_batch_id, category_id, dedupe_key,
				booking_date, value_date, amount_cents, currency, original_amount_cents,
				original_currency, exchange_rate, balance_after_cents, payee, description,
				note, search_text, classification_status
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			input.transactionId,
			input.profileId,
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
			input.classificationStatus
		)
		.run();
}

async function insertReviewFlag(db: DbClient, transactionId: string): Promise<void> {
	await db
		.prepare(
			`INSERT INTO transaction_review_flags (id, transaction_id, reason)
			VALUES (?, ?, ?)`
		)
		.bind(crypto.randomUUID(), transactionId, 'unknown_category')
		.run();
}

async function insertRowError(
	db: DbClient,
	batchId: string,
	profileId: string,
	error: ParseError
): Promise<void> {
	await db
		.prepare(
			`INSERT INTO import_row_errors (id, import_batch_id, profile_id, row_number, code, message)
			VALUES (?, ?, ?, ?, ?, ?)`
		)
		.bind(crypto.randomUUID(), batchId, profileId, error.rowNumber, error.code, error.message)
		.run();
}

function matchCategoryRule(
	row: NormalizedTransaction,
	rules: CategoryRule[]
): CategoryRule | undefined {
	return rules.find((rule) => matchesRule(row, rule));
}

function matchesRule(row: NormalizedTransaction, rule: CategoryRule): boolean {
	const value = getRuleFieldValue(row, rule.field).toLowerCase();
	const pattern = rule.pattern.toLowerCase();

	switch (rule.operator) {
		case 'contains':
			return value.includes(pattern);
		case 'equals':
			return value === pattern;
		case 'starts_with':
			return value.startsWith(pattern);
		case 'regex':
			try {
				return new RegExp(rule.pattern, 'i').test(getRuleFieldValue(row, rule.field));
			} catch {
				return false;
			}
	}
}

function getRuleFieldValue(row: NormalizedTransaction, field: CategoryRule['field']): string {
	switch (field) {
		case 'payee':
			return row.payee ?? '';
		case 'description':
			return row.description ?? '';
		case 'note':
			return row.note ?? '';
		case 'search_text':
			return row.searchText;
	}
}

interface DedupeRow extends DbRow {
	dedupe_key: string;
}

interface IdRow extends DbRow {
	id: string;
}
