import type { NormalizedTransaction, ParseError } from '$lib/banks';
import { ConflictError, ValidationError } from '../accounts/errors';
import { listCategoryRules } from '../categories/repository';
import type { CategoryRule } from '../categories/types';
import { matchesCategoryRule } from '../categories/matcher';
import type { DbClient, DbRow, DbStatement } from '../db-client';
import { reconcilePlans } from '../plans/matching';
import { generateRecurringSuggestions } from '../recurring/repository';
import { prepareImport } from './preparation';
import { sha256Hex } from './shared';
import type {
	ConfirmImportInput,
	ImportAccountAssignment,
	ImportAccountReport,
	ImportReport
} from './types';

export async function confirmImport(
	db: DbClient,
	input: ConfirmImportInput
): Promise<ImportReport> {
	if (!input.csv.trim()) throw new ValidationError('CSV file is required');
	const expectedHash = input.expectedHash.trim();
	if (!expectedHash) throw new ValidationError('expectedHash is required');
	const expectedConfigurationHash = input.expectedConfigurationHash.trim();
	if (!expectedConfigurationHash)
		throw new ValidationError('expectedConfigurationHash is required');
	const fileHash = await sha256Hex(input.csv);
	if (fileHash !== expectedHash) throw new ValidationError('File hash does not match preview');

	const prepared = await prepareImport(db, {
		adapterId: input.adapterId,
		csv: input.csv,
		assignments: input.assignments
	});
	if (prepared.preview.configurationHash !== expectedConfigurationHash) {
		throw new ValidationError('Account configuration does not match preview');
	}
	await assertNewImportRun(db, prepared.preview.adapterId, fileHash);
	if (prepared.groups.every((group) => group.rows.length === 0)) {
		throw new ConflictError('No new transactions to import');
	}

	const rules = await listCategoryRules(db);
	const runId = crypto.randomUUID();
	const statements: DbStatement[] = [];
	const accountReports: ImportAccountReport[] = [];
	const batchIds: string[] = [];
	const transactionRows: TransactionInsertRow[] = [];
	const reviewFlagRows: ReviewFlagInsertRow[] = [];

	statements.push(
		createRunStatement(db, {
			runId,
			fileHash,
			adapterId: prepared.preview.adapterId,
			parsedRows: prepared.preview.summary.parsedRows,
			errorCount: prepared.preview.summary.errorCount,
			startDate: prepared.preview.summary.startDate,
			endDate: prepared.preview.summary.endDate,
			importedCount: prepared.groups.reduce((sum, group) => sum + group.rows.length, 0),
			duplicateCount: prepared.groups.reduce(
				(sum, group) => sum + group.preview.duplicateRows.length,
				0
			)
		})
	);
	statements.push(createFileClaimStatement(db, runId, prepared.preview.adapterId, fileHash));

	for (const [groupIndex, group] of prepared.groups.entries()) {
		const assignment = group.preview.assignment!;
		const createdAccount = !assignment.targetAccountId;
		const accountId = assignment.targetAccountId ?? crypto.randomUUID();
		const accountName = group.preview.targetAccountName!;
		const batchId = crypto.randomUUID();
		batchIds.push(batchId);
		if (createdAccount) statements.push(createAccountStatement(db, accountId, assignment));
		if (group.preview.sourceAccountKey !== null) {
			statements.push(
				upsertMappingStatement(
					db,
					prepared.preview.adapterId,
					group.preview.sourceAccountKey,
					accountId
				)
			);
		}

		const reportedBalanceCents = getReportedBalance(
			assignment,
			group.preview.calculatedBalanceCents
		);
		statements.push(
			createBatchStatement(db, {
				batchId,
				runId,
				accountId,
				fileHash,
				adapterId: prepared.preview.adapterId,
				sourceAccountKey: group.preview.sourceAccountKey,
				startDate: group.preview.startDate,
				endDate: group.preview.endDate,
				rowCount: group.preview.rowCount,
				importedCount: group.rows.length,
				duplicateCount: group.preview.duplicateRows.length,
				errorCount: groupIndex === 0 ? prepared.preview.summary.errorCount : 0,
				reportedBalanceCents,
				calculatedBalanceCents: group.preview.calculatedBalanceCents
			})
		);

		for (const row of group.rows) {
			const match = matchCategoryRule(row, rules);
			const transactionId = crypto.randomUUID();
			transactionRows.push({
				id: transactionId,
				accountId,
				importBatchId: batchId,
				categoryId: match?.categoryId ?? null,
				dedupeKey: row.dedupeKey,
				bookingDate: row.bookingDate,
				valueDate: row.valueDate ?? null,
				amountCents: row.amountCents,
				currency: row.currency,
				originalAmountCents: row.originalAmountCents ?? null,
				originalCurrency: row.originalCurrency ?? null,
				exchangeRate: row.exchangeRate ?? null,
				balanceAfterCents: row.balanceAfterCents ?? null,
				payee: row.payee ?? null,
				description: row.description ?? null,
				note: row.note ?? null,
				searchText: row.searchText,
				classificationStatus: match ? 'auto' : 'unknown',
				sourceAccountKey: row.source.sourceAccountKey ?? null
			});
			if (!match) {
				reviewFlagRows.push({
					id: crypto.randomUUID(),
					transactionId,
					reason: 'unknown_category'
				});
			}
		}

		if (!group.preview.targetBalanceInitialized) {
			if (!group.preview.endDate) throw new ValidationError('Account group has no valid rows');
			if (reportedBalanceCents === null) {
				throw new ValidationError('A balance is required to initialize an account');
			}
			statements.push(
				createBalanceSnapshotStatement(db, {
					accountId,
					batchId,
					snapshotDate: group.preview.endDate,
					balanceCents: reportedBalanceCents
				})
			);
		}

		accountReports.push({
			batchId,
			accountId,
			accountName,
			createdAccount,
			sourceAccountKey: group.preview.sourceAccountKey,
			startDate: group.preview.startDate,
			endDate: group.preview.endDate,
			rowCount: group.preview.rowCount,
			importedCount: group.rows.length,
			duplicateCount: group.preview.duplicateRows.length,
			unknownCount: 0,
			balanceMode: assignment.balanceMode,
			reportedBalanceCents,
			calculatedBalanceCents: group.preview.calculatedBalanceCents
		});
	}

	if (transactionRows.length > 0) {
		statements.push(createTransactionsStatement(db, transactionRows));
	}
	if (reviewFlagRows.length > 0) {
		statements.push(createReviewFlagsStatement(db, reviewFlagRows));
	}

	for (const error of prepared.preview.errors) {
		statements.push(insertRowErrorStatement(db, batchIds[0]!, error));
	}
	try {
		await runImportWriteBatch(db, statements);
	} catch (error) {
		if (isDuplicateImportFileError(error)) {
			throw new ConflictError('Import run already exists for this file');
		}
		throw error;
	}
	await reconcilePlans(db);
	await updateFinalUnknownCounts(db, runId, accountReports);
	await generateRecurringSuggestions(db);

	return {
		runId,
		adapterId: prepared.preview.adapterId,
		fileHash,
		startDate: prepared.preview.summary.startDate,
		endDate: prepared.preview.summary.endDate,
		rowCount: prepared.preview.summary.parsedRows,
		importedCount: accountReports.reduce((sum, row) => sum + row.importedCount, 0),
		duplicateCount: accountReports.reduce((sum, row) => sum + row.duplicateCount, 0),
		errorCount: prepared.preview.summary.errorCount,
		unknownCount: accountReports.reduce((sum, row) => sum + row.unknownCount, 0),
		accounts: accountReports
	};
}

async function updateFinalUnknownCounts(
	db: DbClient,
	runId: string,
	accountReports: ImportAccountReport[]
): Promise<void> {
	const { results } = await db
		.prepare(
			`SELECT t.account_id, COUNT(*) AS unknown_count
			FROM transactions t
			INNER JOIN import_batches b ON b.id = t.import_batch_id
			WHERE b.import_run_id = ? AND t.classification_status = 'unknown'
			GROUP BY t.account_id`
		)
		.bind(runId)
		.all<UnknownCountRow>();
	const countsByAccount = new Map(results.map((row) => [row.account_id, row.unknown_count]));
	for (const report of accountReports) {
		report.unknownCount = countsByAccount.get(report.accountId) ?? 0;
	}
}

async function assertNewImportRun(
	db: DbClient,
	adapterId: string,
	fileHash: string
): Promise<void> {
	const existing = await db
		.prepare('SELECT id FROM import_runs WHERE adapter_id = ? AND file_hash = ? LIMIT 1')
		.bind(adapterId, fileHash)
		.first<IdRow>();
	if (existing) throw new ConflictError('Import run already exists for this file');
}

function createRunStatement(
	db: DbClient,
	input: {
		runId: string;
		fileHash: string;
		adapterId: string;
		parsedRows: number;
		errorCount: number;
		importedCount: number;
		duplicateCount: number;
		startDate: string | null;
		endDate: string | null;
	}
): DbStatement {
	return db
		.prepare(
			`INSERT INTO import_runs (
				id, file_hash, adapter_id, start_date, end_date, row_count,
				imported_count, duplicate_count, error_count
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			input.runId,
			input.fileHash,
			input.adapterId,
			input.startDate,
			input.endDate,
			input.parsedRows,
			input.importedCount,
			input.duplicateCount,
			input.errorCount
		);
}

function createFileClaimStatement(
	db: DbClient,
	runId: string,
	adapterId: string,
	fileHash: string
): DbStatement {
	return db
		.prepare(
			`INSERT INTO import_file_claims (adapter_id, file_hash, import_run_id)
			VALUES (?, ?, ?)`
		)
		.bind(adapterId, fileHash, runId);
}

function createAccountStatement(
	db: DbClient,
	accountId: string,
	assignment: ImportAccountAssignment
): DbStatement {
	return db
		.prepare(
			`INSERT INTO accounts (id, name, institution, currency, display_order)
			VALUES (?, ?, ?, 'EUR', (SELECT COALESCE(MAX(display_order), -1) + 1 FROM accounts))`
		)
		.bind(
			accountId,
			assignment.newAccount!.name.trim(),
			assignment.newAccount!.institution?.trim() || null
		);
}

function upsertMappingStatement(
	db: DbClient,
	adapterId: string,
	sourceAccountKey: string,
	accountId: string
): DbStatement {
	return db
		.prepare(
			`INSERT INTO import_account_mappings (adapter_id, source_account_key, account_id)
			VALUES (?, ?, ?)
			ON CONFLICT(adapter_id, source_account_key) DO UPDATE SET
				account_id = excluded.account_id,
				updated_at = CURRENT_TIMESTAMP`
		)
		.bind(adapterId, sourceAccountKey, accountId);
}

function createBatchStatement(
	db: DbClient,
	input: {
		batchId: string;
		runId: string;
		accountId: string;
		fileHash: string;
		adapterId: string;
		sourceAccountKey: string | null;
		startDate: string | null;
		endDate: string | null;
		rowCount: number;
		importedCount: number;
		duplicateCount: number;
		errorCount: number;
		reportedBalanceCents: number | null;
		calculatedBalanceCents: number | null;
	}
): DbStatement {
	return db
		.prepare(
			`INSERT INTO import_batches (
				id, account_id, file_hash, adapter_id, start_date, end_date,
				row_count, imported_count, duplicate_count, error_count,
				reported_balance_cents, calculated_balance_cents, import_run_id,
				source_account_key
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
			input.errorCount,
			input.reportedBalanceCents,
			input.calculatedBalanceCents,
			input.runId,
			input.sourceAccountKey
		);
}

function createBalanceSnapshotStatement(
	db: DbClient,
	input: { accountId: string; batchId: string; snapshotDate: string; balanceCents: number }
): DbStatement {
	return db
		.prepare(
			`INSERT INTO account_balance_snapshots (
				id, account_id, snapshot_date, balance_cents, source, anchor_import_batch_id
			) VALUES (?, ?, ?, ?, 'imported', ?)`
		)
		.bind(
			crypto.randomUUID(),
			input.accountId,
			input.snapshotDate,
			input.balanceCents,
			input.batchId
		);
}

function createTransactionsStatement(db: DbClient, rows: TransactionInsertRow[]): DbStatement {
	return db
		.prepare(
			`INSERT INTO transactions (
				id, account_id, import_batch_id, category_id, dedupe_key,
				booking_date, value_date, amount_cents, currency, original_amount_cents,
				original_currency, exchange_rate, balance_after_cents, payee, description,
				note, search_text, classification_status, source_account_key
			)
			SELECT
				json_extract(value, '$.id'),
				json_extract(value, '$.accountId'),
				json_extract(value, '$.importBatchId'),
				json_extract(value, '$.categoryId'),
				json_extract(value, '$.dedupeKey'),
				json_extract(value, '$.bookingDate'),
				json_extract(value, '$.valueDate'),
				json_extract(value, '$.amountCents'),
				json_extract(value, '$.currency'),
				json_extract(value, '$.originalAmountCents'),
				json_extract(value, '$.originalCurrency'),
				json_extract(value, '$.exchangeRate'),
				json_extract(value, '$.balanceAfterCents'),
				json_extract(value, '$.payee'),
				json_extract(value, '$.description'),
				json_extract(value, '$.note'),
				json_extract(value, '$.searchText'),
				json_extract(value, '$.classificationStatus'),
				json_extract(value, '$.sourceAccountKey')
			FROM json_each(?)`
		)
		.bind(JSON.stringify(rows));
}

function createReviewFlagsStatement(db: DbClient, rows: ReviewFlagInsertRow[]): DbStatement {
	return db
		.prepare(
			`INSERT INTO transaction_review_flags (id, transaction_id, reason)
			SELECT
				json_extract(value, '$.id'),
				json_extract(value, '$.transactionId'),
				json_extract(value, '$.reason')
			FROM json_each(?)`
		)
		.bind(JSON.stringify(rows));
}

function insertRowErrorStatement(db: DbClient, batchId: string, error: ParseError): DbStatement {
	return db
		.prepare(
			`INSERT INTO import_row_errors (id, import_batch_id, row_number, code, message)
			VALUES (?, ?, ?, ?, ?)`
		)
		.bind(crypto.randomUUID(), batchId, error.rowNumber, error.code, error.message);
}

function getReportedBalance(
	assignment: ImportAccountAssignment,
	calculatedBalanceCents: number | null
): number | null {
	return assignment.balanceMode === 'complete_history'
		? calculatedBalanceCents!
		: assignment.balanceMode === 'reported'
			? assignment.reportedBalanceCents!
			: null;
}

async function runImportWriteBatch(db: DbClient, statements: DbStatement[]): Promise<void> {
	if (!db.batch)
		throw new Error('Database batch support is required for atomic import confirmation');
	await db.batch(statements);
}

function isDuplicateImportFileError(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	return (
		error.message.includes('UNIQUE constraint failed') &&
		error.message.includes('import_file_claims.adapter_id') &&
		error.message.includes('import_file_claims.file_hash')
	);
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

interface IdRow extends DbRow {
	id: string;
}

interface UnknownCountRow extends DbRow {
	account_id: string;
	unknown_count: number;
}

interface TransactionInsertRow {
	id: string;
	accountId: string;
	importBatchId: string;
	categoryId: string | null;
	dedupeKey: string;
	bookingDate: string;
	valueDate: string | null;
	amountCents: number;
	currency: string;
	originalAmountCents: number | null;
	originalCurrency: string | null;
	exchangeRate: string | null;
	balanceAfterCents: number | null;
	payee: string | null;
	description: string | null;
	note: string | null;
	searchText: string;
	classificationStatus: 'auto' | 'unknown';
	sourceAccountKey: string | null;
}

interface ReviewFlagInsertRow {
	id: string;
	transactionId: string;
	reason: 'unknown_category';
}
