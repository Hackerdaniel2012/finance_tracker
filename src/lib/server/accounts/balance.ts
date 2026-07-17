import type { NormalizedTransaction } from '$lib/banks';
import type { DbClient, DbRow } from '../db-client';

export interface CalculatedAccountBalance {
	accountId: string;
	accountName: string;
	balanceCents: number | null;
	balanceInitialized: boolean;
}

export interface BalanceSnapshot {
	accountId: string;
	snapshotDate: string;
	balanceCents: number;
	anchorImportBatchId: string | null;
	anchorImportOrder: number | null;
	createdAt: string;
	id: string;
}

export interface BalanceTransaction {
	accountId: string;
	bookingDate: string;
	amountCents: number;
	importBatchId: string | null;
	importOrder: number | null;
	createdAt: string;
	id: string;
}

export async function listCalculatedAccountBalances(
	db: DbClient,
	asOfDate: string,
	accountId?: string
): Promise<CalculatedAccountBalance[]> {
	const accountClause = accountId ? 'WHERE id = ?' : '';
	const transactionClause = accountId ? 'AND t.account_id = ?' : '';
	const snapshotClause = accountId ? 'AND s.account_id = ?' : '';
	const [accountResult, transactionResult, snapshotResult] = await Promise.all([
		db
			.prepare(
				`SELECT id, name FROM accounts ${accountClause} ORDER BY display_order, created_at, id`
			)
			.bind(...(accountId ? [accountId] : []))
			.all<AccountBalanceIdentityRow>(),
		db
			.prepare(
				`SELECT t.account_id, t.booking_date, t.amount_cents, t.import_batch_id,
					r.import_order, t.created_at, t.id
				FROM transactions t
				LEFT JOIN import_batches b ON b.id = t.import_batch_id
				LEFT JOIN import_runs r ON r.id = b.import_run_id
				WHERE 1 = 1 ${transactionClause}
				ORDER BY t.account_id, t.booking_date, t.created_at, t.id`
			)
			.bind(...(accountId ? [accountId] : []))
			.all<BalanceTransactionRow>(),
		db
			.prepare(
				`SELECT s.account_id, s.snapshot_date, s.balance_cents, s.anchor_import_batch_id,
					r.import_order AS anchor_import_order, s.created_at, s.id
				FROM account_balance_snapshots s
				LEFT JOIN import_batches b ON b.id = s.anchor_import_batch_id
				LEFT JOIN import_runs r ON r.id = b.import_run_id
				WHERE 1 = 1 ${snapshotClause}
				ORDER BY s.account_id, s.snapshot_date, s.created_at, s.id`
			)
			.bind(...(accountId ? [accountId] : []))
			.all<BalanceSnapshotRow>()
	]);

	return accountResult.results.map((account) => {
		const balance = calculateBalanceAsOf(
			snapshotResult.results
				.filter((snapshot) => snapshot.account_id === account.id)
				.map(mapSnapshot),
			transactionResult.results
				.filter((transaction) => transaction.account_id === account.id)
				.map(mapTransaction),
			asOfDate
		);
		return {
			accountId: account.id,
			accountName: account.name,
			balanceCents: balance,
			balanceInitialized: balance !== null
		};
	});
}

export async function getLatestBalanceSnapshot(
	db: DbClient,
	accountId: string
): Promise<BalanceSnapshot | null> {
	const row = await db
		.prepare(
			`SELECT s.account_id, s.snapshot_date, s.balance_cents, s.anchor_import_batch_id,
				r.import_order AS anchor_import_order, s.created_at, s.id
			FROM account_balance_snapshots s
			LEFT JOIN import_batches b ON b.id = s.anchor_import_batch_id
			LEFT JOIN import_runs r ON r.id = b.import_run_id
			WHERE s.account_id = ?
			ORDER BY s.snapshot_date DESC, s.created_at DESC, s.id DESC
			LIMIT 1`
		)
		.bind(accountId)
		.first<BalanceSnapshotRow>();
	return row ? mapSnapshot(row) : null;
}

export async function calculateBalanceAfterCandidates(
	db: DbClient,
	accountId: string,
	candidates: NormalizedTransaction[]
): Promise<number | null> {
	const snapshot = await getLatestBalanceSnapshot(db, accountId);
	if (!snapshot) return null;

	const current = (await listCalculatedAccountBalances(db, '9999-12-31', accountId))[0]
		?.balanceCents;
	if (current === null || current === undefined) return null;

	return candidates.reduce((balance, transaction) => {
		return candidateFollowsSnapshot(transaction, snapshot)
			? balance + transaction.amountCents
			: balance;
	}, current);
}

export function calculateBalanceAsOf(
	snapshots: BalanceSnapshot[],
	transactions: BalanceTransaction[],
	asOfDate: string
): number | null {
	const orderedSnapshots = [...snapshots].sort(compareSnapshots);
	const priorSnapshot = orderedSnapshots.filter((row) => row.snapshotDate <= asOfDate).at(-1);
	if (priorSnapshot) {
		return (
			priorSnapshot.balanceCents +
			transactions
				.filter(
					(transaction) =>
						transaction.bookingDate <= asOfDate &&
						transactionFollowsSnapshot(transaction, priorSnapshot)
				)
				.reduce((sum, transaction) => sum + transaction.amountCents, 0)
		);
	}

	const futureSnapshot = orderedSnapshots.find((row) => row.snapshotDate > asOfDate);
	if (!futureSnapshot) return null;

	const includedAfterDate = transactions.filter(
		(transaction) =>
			transaction.bookingDate > asOfDate &&
			transactionIncludedInSnapshot(transaction, futureSnapshot)
	);
	return (
		futureSnapshot.balanceCents -
		includedAfterDate.reduce((sum, transaction) => sum + transaction.amountCents, 0)
	);
}

function transactionFollowsSnapshot(
	transaction: BalanceTransaction,
	snapshot: BalanceSnapshot
): boolean {
	if (transaction.bookingDate !== snapshot.snapshotDate) {
		return transaction.bookingDate > snapshot.snapshotDate;
	}
	if (snapshot.anchorImportBatchId === null) return false;
	if (transaction.importBatchId === snapshot.anchorImportBatchId) return false;
	if (transaction.importOrder === null || snapshot.anchorImportOrder === null) return false;
	return transaction.importOrder > snapshot.anchorImportOrder;
}

function transactionIncludedInSnapshot(
	transaction: BalanceTransaction,
	snapshot: BalanceSnapshot
): boolean {
	if (transaction.bookingDate !== snapshot.snapshotDate) {
		return transaction.bookingDate < snapshot.snapshotDate;
	}
	return !transactionFollowsSnapshot(transaction, snapshot);
}

function candidateFollowsSnapshot(
	transaction: NormalizedTransaction,
	snapshot: BalanceSnapshot
): boolean {
	return (
		transaction.bookingDate > snapshot.snapshotDate ||
		(snapshot.anchorImportBatchId !== null && transaction.bookingDate === snapshot.snapshotDate)
	);
}

function compareSnapshots(left: BalanceSnapshot, right: BalanceSnapshot): number {
	return (
		left.snapshotDate.localeCompare(right.snapshotDate) ||
		left.createdAt.localeCompare(right.createdAt) ||
		left.id.localeCompare(right.id)
	);
}

function mapSnapshot(row: BalanceSnapshotRow): BalanceSnapshot {
	return {
		accountId: row.account_id,
		snapshotDate: row.snapshot_date,
		balanceCents: row.balance_cents,
		anchorImportBatchId: row.anchor_import_batch_id,
		anchorImportOrder: row.anchor_import_order,
		createdAt: row.created_at,
		id: row.id
	};
}

function mapTransaction(row: BalanceTransactionRow): BalanceTransaction {
	return {
		accountId: row.account_id,
		bookingDate: row.booking_date,
		amountCents: row.amount_cents,
		importBatchId: row.import_batch_id,
		importOrder: row.import_order,
		createdAt: row.created_at,
		id: row.id
	};
}

interface AccountBalanceIdentityRow extends DbRow {
	id: string;
	name: string;
}

interface BalanceSnapshotRow extends DbRow {
	account_id: string;
	snapshot_date: string;
	balance_cents: number;
	anchor_import_batch_id: string | null;
	anchor_import_order: number | null;
	created_at: string;
	id: string;
}

interface BalanceTransactionRow extends DbRow {
	account_id: string;
	booking_date: string;
	amount_cents: number;
	import_batch_id: string | null;
	import_order: number | null;
	created_at: string;
	id: string;
}
