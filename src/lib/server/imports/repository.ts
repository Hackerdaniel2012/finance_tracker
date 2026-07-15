import type { BankId } from '$lib/banks';
import { NotFoundError } from '../accounts/errors';
import type { DbClient, DbRow } from '../db-client';
import { rematchPlans } from '../plans/rematching';
import { rebuildRecurringSuggestions } from '../recurring/repository';
import type { ImportBatch } from './types';

export async function listImportBatches(db: DbClient): Promise<ImportBatch[]> {
	const { results } = await db
		.prepare(
			`SELECT
				b.id,
				b.account_id,
				a.name AS account_name,
				b.adapter_id,
				b.file_hash,
				b.combine_before_date,
				b.start_date,
				b.end_date,
				b.row_count,
				b.imported_count,
				b.duplicate_count,
				b.error_count,
				b.combined_source_count,
				b.combined_record_count,
				b.detailed_import_count,
				b.created_at
			FROM import_batches b
			INNER JOIN accounts a ON a.id = b.account_id
			ORDER BY b.created_at DESC, b.id DESC`
		)
		.all<ImportBatchRow>();

	return results.map(mapImportBatch);
}

export async function deleteImportBatch(db: DbClient, id: string): Promise<void> {
	const batchId = id.trim();
	if (!batchId) {
		throw new NotFoundError('Import batch not found');
	}

	const existing = await db
		.prepare('SELECT id FROM import_batches WHERE id = ?')
		.bind(batchId)
		.first<IdRow>();

	if (!existing) {
		throw new NotFoundError('Import batch not found');
	}

	const { results: affectedPlans } = await db
		.prepare(
			`SELECT DISTINCT pt.plan_id
			FROM plan_transactions pt
			INNER JOIN transactions t ON t.id = pt.transaction_id
			WHERE t.import_batch_id = ? AND pt.match_kind = 'automatic'`
		)
		.bind(batchId)
		.all<AffectedPlanRow>();
	if (!db.batch)
		throw new Error('Database batch support is required for reversible import deletion');
	await rematchPlans(
		db,
		affectedPlans.map((row) => row.plan_id),
		[db.prepare('DELETE FROM import_batches WHERE id = ?').bind(batchId)]
	);
	await rebuildRecurringSuggestions(db);
}

function mapImportBatch(row: ImportBatchRow): ImportBatch {
	return {
		id: row.id,
		accountId: row.account_id,
		accountName: row.account_name,
		adapterId: row.adapter_id,
		fileHash: row.file_hash,
		combineBeforeDate: row.combine_before_date,
		startDate: row.start_date,
		endDate: row.end_date,
		rowCount: row.row_count,
		importedCount: row.imported_count,
		duplicateCount: row.duplicate_count,
		errorCount: row.error_count,
		combinedSourceCount: row.combined_source_count,
		combinedRecordCount: row.combined_record_count,
		detailedImportCount: row.detailed_import_count,
		createdAt: row.created_at
	};
}

interface ImportBatchRow extends DbRow {
	id: string;
	account_id: string;
	account_name: string;
	adapter_id: BankId;
	file_hash: string;
	combine_before_date: string | null;
	start_date: string | null;
	end_date: string | null;
	row_count: number;
	imported_count: number;
	duplicate_count: number;
	error_count: number;
	combined_source_count: number;
	combined_record_count: number;
	detailed_import_count: number;
	created_at: string;
}

interface IdRow extends DbRow {
	id: string;
}

interface AffectedPlanRow extends DbRow {
	plan_id: string;
}
