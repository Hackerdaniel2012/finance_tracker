import type { BankId } from '$lib/banks';
import { ConflictError, NotFoundError } from '../accounts/errors';
import type { DbClient, DbRow } from '../db-client';
import { rematchPlans } from '../plans/rematching';
import { rebuildRecurringSuggestions } from '../recurring/repository';
import type { ImportRun } from './types';

export async function listImportRuns(db: DbClient): Promise<ImportRun[]> {
	const { results } = await db
		.prepare(
			`SELECT
				r.id, r.adapter_id, r.file_hash, r.start_date, r.end_date,
				r.row_count, r.imported_count, r.duplicate_count, r.error_count,
				r.created_at, b.account_id, a.name AS account_name,
				b.imported_count AS account_imported_count,
				NOT EXISTS (
					SELECT 1
					FROM import_batches selected_batch
					INNER JOIN import_batches newer_batch
						ON newer_batch.account_id = selected_batch.account_id
					INNER JOIN import_runs newer_run
						ON newer_run.id = newer_batch.import_run_id
					WHERE selected_batch.import_run_id = r.id
						AND newer_run.import_order > r.import_order
				) AS can_delete
			FROM import_runs r
			INNER JOIN import_batches b ON b.import_run_id = r.id
			INNER JOIN accounts a ON a.id = b.account_id
			ORDER BY r.import_order DESC, b.account_id ASC`
		)
		.all<ImportRunRow>();

	const runs = new Map<string, ImportRun>();
	for (const row of results) {
		let run = runs.get(row.id);
		if (!run) {
			run = {
				id: row.id,
				adapterId: row.adapter_id,
				fileHash: row.file_hash,
				startDate: row.start_date,
				endDate: row.end_date,
				rowCount: row.row_count,
				importedCount: row.imported_count,
				duplicateCount: row.duplicate_count,
				errorCount: row.error_count,
				accounts: [],
				canDelete: row.can_delete === 1,
				createdAt: row.created_at
			};
			runs.set(row.id, run);
		}
		run.accounts.push({
			accountId: row.account_id,
			accountName: row.account_name,
			importedCount: row.account_imported_count
		});
	}
	return [...runs.values()];
}

export async function deleteImportRun(db: DbClient, id: string): Promise<void> {
	const runId = id.trim();
	if (!runId) throw new NotFoundError('Import run not found');
	const existing = await db
		.prepare('SELECT id FROM import_runs WHERE id = ?')
		.bind(runId)
		.first<IdRow>();
	if (!existing) throw new NotFoundError('Import run not found');
	const newer = await db
		.prepare(
			`SELECT newer_run.id
			FROM import_runs selected_run
			INNER JOIN import_batches selected_batch
				ON selected_batch.import_run_id = selected_run.id
			INNER JOIN import_batches newer_batch
				ON newer_batch.account_id = selected_batch.account_id
			INNER JOIN import_runs newer_run
				ON newer_run.id = newer_batch.import_run_id
				AND newer_run.import_order > selected_run.import_order
			WHERE selected_run.id = ?
			LIMIT 1`
		)
		.bind(runId)
		.first<IdRow>();
	if (newer) throw new ConflictError('Newer imports must be deleted first');

	const { results: affectedPlans } = await db
		.prepare(
			`SELECT DISTINCT pt.plan_id
			FROM plan_transactions pt
			INNER JOIN transactions t ON t.id = pt.transaction_id
			INNER JOIN import_batches b ON b.id = t.import_batch_id
			WHERE b.import_run_id = ? AND pt.match_kind = 'automatic'`
		)
		.bind(runId)
		.all<AffectedPlanRow>();
	if (!db.batch)
		throw new Error('Database batch support is required for reversible import deletion');
	await rematchPlans(
		db,
		affectedPlans.map((row) => row.plan_id),
		[db.prepare('DELETE FROM import_runs WHERE id = ?').bind(runId)]
	);
	await rebuildRecurringSuggestions(db);
}

interface ImportRunRow extends DbRow {
	id: string;
	adapter_id: BankId;
	file_hash: string;
	start_date: string | null;
	end_date: string | null;
	row_count: number;
	imported_count: number;
	duplicate_count: number;
	error_count: number;
	created_at: string;
	account_id: string;
	account_name: string;
	account_imported_count: number;
	can_delete: number;
}
interface IdRow extends DbRow {
	id: string;
}
interface AffectedPlanRow extends DbRow {
	plan_id: string;
}
