import type { BankId } from '$lib/banks';
import { NotFoundError } from '../accounts/errors';
import type { DbClient, DbRow } from '../db-client';
import type { ImportBatch } from './types';

export async function listImportBatches(db: DbClient): Promise<ImportBatch[]> {
	const { results } = await db
		.prepare(
			`SELECT
				b.id,
				b.profile_id,
				p.account_id,
				a.name AS account_name,
				b.adapter_id,
				b.file_hash,
				b.start_date,
				b.end_date,
				b.row_count,
				b.imported_count,
				b.duplicate_count,
				b.error_count,
				b.created_at
			FROM import_batches b
			INNER JOIN import_profiles p ON p.id = b.profile_id
			INNER JOIN accounts a ON a.id = p.account_id
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

	await db.prepare('DELETE FROM import_batches WHERE id = ?').bind(batchId).run();
}

function mapImportBatch(row: ImportBatchRow): ImportBatch {
	return {
		id: row.id,
		profileId: row.profile_id,
		accountId: row.account_id,
		accountName: row.account_name,
		adapterId: row.adapter_id,
		fileHash: row.file_hash,
		startDate: row.start_date,
		endDate: row.end_date,
		rowCount: row.row_count,
		importedCount: row.imported_count,
		duplicateCount: row.duplicate_count,
		errorCount: row.error_count,
		createdAt: row.created_at
	};
}

interface ImportBatchRow extends DbRow {
	id: string;
	profile_id: string;
	account_id: string;
	account_name: string;
	adapter_id: BankId;
	file_hash: string;
	start_date: string | null;
	end_date: string | null;
	row_count: number;
	imported_count: number;
	duplicate_count: number;
	error_count: number;
	created_at: string;
}

interface IdRow extends DbRow {
	id: string;
}
