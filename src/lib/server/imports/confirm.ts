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

	statements.push(
		createRunStatement(db, {
			runId,
			fileHash,
			adapterId: prepared.preview.adapterId,
			...prepared.preview.summary
		})
	);
	statements.push(
		createFileClaimStatement(db, runId, prepared.preview.adapterId, fileHash)
	);

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
			statements.push(
				insertTransactionStatement(db, {
					transactionId,
					accountId,
					batchId,
					categoryId: match?.categoryId ?? null,
					classificationStatus: match ? 'auto' : 'unknown',
					row
				})
			);
			if (!match) statements.push(insertReviewFlagStatement(db, transactionId));
		}

		if (!group.preview.targetBalanceInitialized) {
			if (!group.preview.endDate) throw new ValidationError('Account group has no valid rows');
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
		skippedRows: number;
		errorCount: number;
		accountCount: number;
		duplicateEstimate: number;
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
			input.parsedRows - input.duplicateEstimate,
			input.duplicateEstimate,
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
		reportedBalanceCents: number;
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
				note, search_text, classification_status, source_account_key
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
			input.row.source.sourceAccountKey ?? null
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

function getReportedBalance(
	assignment: ImportAccountAssignment,
	calculatedBalanceCents: number | null
): number {
	return assignment.balanceMode === 'complete_history'
		? calculatedBalanceCents!
		: assignment.reportedBalanceCents!;
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
