import { NotFoundError } from '../accounts/errors';
import {
	calculateBalanceAsOf,
	listCalculatedAccountBalances,
	type BalanceSnapshot,
	type BalanceTransaction
} from '../accounts/balance';
import type { DbClient, DbRow } from '../db-client';
import type {
	AccountBalanceHistoryReport,
	NetWorthReportOptions,
	NetWorthReport,
	ReportDateRange,
	SummaryReport,
	SummaryReportOptions
} from './types';

export async function getSummaryReport(
	db: DbClient,
	range: ReportDateRange,
	options?: SummaryReportOptions
): Promise<SummaryReport> {
	const { accountId } = options ?? {};
	const [totals, byCategory, byMonthCategory, byAccount, recentTransactions] = await Promise.all([
		getSummaryTotals(db, range, accountId),
		getSummaryByCategory(db, range, accountId),
		getSummaryByMonthCategory(db, range, accountId),
		getSummaryByAccount(db, range, accountId),
		getRecentTransactions(db, range, accountId)
	]);

	return {
		range,
		totals,
		byCategory,
		byMonthCategory,
		byAccount,
		recentTransactions
	};
}

async function getSummaryByMonthCategory(
	db: DbClient,
	range: ReportDateRange,
	accountId?: string
): Promise<SummaryReport['byMonthCategory']> {
	const accountClause = accountId ? 'AND t.account_id = ?' : '';
	const { results } = await db
		.prepare(
			`SELECT strftime('%Y-%m', t.booking_date) AS month,
				t.category_id,
				COALESCE(c.name, 'Unknown') AS category_name,
				-COALESCE(SUM(CASE WHEN t.amount_cents < 0 THEN t.amount_cents ELSE 0 END), 0) AS expense_cents
			FROM transactions t
			LEFT JOIN categories c ON c.id = t.category_id
			WHERE t.booking_date BETWEEN ? AND ? ${accountClause}
			GROUP BY month, t.category_id, c.name
			HAVING expense_cents > 0
			ORDER BY month ASC, expense_cents DESC, category_name ASC`
		)
		.bind(
			range.from,
			range.to,
			...(accountId ? [accountId] : [])
		)
		.all<MonthlyCategorySummaryRow>();

	return results.map((row) => ({
		month: row.month,
		categoryId: row.category_id,
		categoryName: row.category_name,
		expenseCents: row.expense_cents
	}));
}

export async function getNetWorthReport(
	db: DbClient,
	range: ReportDateRange,
	options?: NetWorthReportOptions
): Promise<NetWorthReport> {
	const { accountId } = options ?? {};
	const [accounts, liabilities, snapshotRows, balanceEventDates, assetInputs] = await Promise.all([
		getCurrentAccountBalances(db, range.to, accountId),
		getActiveLiabilities(db, range.to, accountId),
		getSnapshotPoints(db, range, accountId),
		getBalanceEventDates(db, range, accountId),
		getAssetInputs(db, range.to, accountId)
	]);
	const currentAssetsCents = accounts.reduce(
		(sum, account) => sum + (account.balanceCents ?? 0),
		0
	);
	const currentLiabilitiesCents = liabilities.reduce(
		(sum, liability) => sum + liability.amountCents,
		0
	);
	const dates = [
		...new Set([
			range.from,
			...snapshotRows.map((row) => row.snapshot_date),
			...balanceEventDates,
			range.to
		])
	].sort();
	const points = [];
	for (const date of dates) {
		const assetsCents = getAssetsCentsAsOf(assetInputs, date, range.to);
		const liabilitiesCents = liabilityTotalAsOf(liabilities, date);

		points.push({
			date,
			assetsCents,
			liabilitiesCents,
			netWorthCents: assetsCents - liabilitiesCents
		});
	}

	if (!points.some((point) => point.date === range.to)) {
		points.push({
			date: range.to,
			assetsCents: currentAssetsCents,
			liabilitiesCents: currentLiabilitiesCents,
			netWorthCents: currentAssetsCents - currentLiabilitiesCents
		});
	}

	return {
		points,
		accounts,
		liabilities
	};
}

export async function getAccountBalanceHistory(
	db: DbClient,
	accountId: string,
	range: ReportDateRange
): Promise<AccountBalanceHistoryReport> {
	const [account, snapshots, transactions] = await Promise.all([
		getAssetAccount(db, accountId),
		getAssetSnapshotsForAccount(db, accountId),
		getAssetTransactionsForAccount(db, accountId)
	]);

	if (!account) {
		throw new NotFoundError('Account not found');
	}

	if (snapshots.length === 0) {
		return { accountId, accountName: account.name, range, points: [] };
	}

	const inputs: AssetInputs = { accounts: [account], transactions, snapshots };
	const eventDates = [
		...new Set([
			range.from,
			...snapshots
				.map((snapshot) => snapshot.snapshot_date)
				.filter((date) => date >= range.from && date <= range.to),
			...transactions
				.map((transaction) => transaction.booking_date)
				.filter((date) => date >= range.from && date <= range.to),
			range.to
		])
	].sort();

	const points = [];
	for (const date of eventDates) {
		points.push({
			date,
			balanceCents: getAccountBalanceAsOf(inputs, account, date, range.to)
		});
	}

	if (!points.some((point) => point.date === range.to)) {
		points.push({
			date: range.to,
			balanceCents: getAccountBalanceAsOf(inputs, account, range.to, range.to)
		});
	}

	return {
		accountId,
		accountName: account.name,
		range,
		points
	};
}

async function getAssetAccount(db: DbClient, accountId: string): Promise<AssetAccountRow | null> {
	return db
		.prepare(
			`SELECT
				id AS account_id,
				name
			FROM accounts
			WHERE id = ?`
		)
		.bind(accountId)
		.first<AssetAccountRow>();
}

async function getAssetSnapshotsForAccount(
	db: DbClient,
	accountId: string
): Promise<AssetSnapshotRow[]> {
	const { results } = await db
		.prepare(
			`SELECT s.account_id, s.snapshot_date, s.balance_cents, s.anchor_import_batch_id,
				r.import_order AS anchor_import_order, s.created_at, s.id
			FROM account_balance_snapshots s
			LEFT JOIN import_batches b ON b.id = s.anchor_import_batch_id
			LEFT JOIN import_runs r ON r.id = b.import_run_id
			WHERE s.account_id = ?
			ORDER BY s.snapshot_date ASC, s.created_at ASC, s.id ASC`
		)
		.bind(accountId)
		.all<AssetSnapshotRow>();

	return results;
}

async function getAssetTransactionsForAccount(
	db: DbClient,
	accountId: string
): Promise<AssetTransactionRow[]> {
	const { results } = await db
		.prepare(
			`SELECT t.account_id, t.booking_date, t.amount_cents, t.import_batch_id,
				r.import_order, t.created_at, t.id
			FROM transactions t
			LEFT JOIN import_batches b ON b.id = t.import_batch_id
			LEFT JOIN import_runs r ON r.id = b.import_run_id
			WHERE t.account_id = ?
			ORDER BY t.booking_date ASC, t.created_at ASC, t.id ASC`
		)
		.bind(accountId)
		.all<AssetTransactionRow>();

	return results;
}

async function getSummaryTotals(
	db: DbClient,
	range: ReportDateRange,
	accountId?: string
): Promise<SummaryReport['totals']> {
	const accountClause = accountId ? 'AND account_id = ?' : '';
	const row = await db
		.prepare(
			`SELECT
				COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END), 0) AS income_cents,
				COALESCE(SUM(CASE WHEN amount_cents < 0 THEN amount_cents ELSE 0 END), 0) AS expense_cents,
				COALESCE(SUM(amount_cents), 0) AS net_cents,
				COUNT(*) AS transaction_count,
				COALESCE(SUM(CASE WHEN classification_status = 'unknown' THEN 1 ELSE 0 END), 0) AS unknown_count
			FROM transactions
			WHERE booking_date BETWEEN ? AND ? ${accountClause}`
		)
		.bind(
			range.from,
			range.to,
			...(accountId ? [accountId] : [])
		)
		.first<TotalsRow>();

	return {
		incomeCents: row?.income_cents ?? 0,
		expenseCents: row?.expense_cents ?? 0,
		netCents: row?.net_cents ?? 0,
		transactionCount: row?.transaction_count ?? 0,
		unknownCount: row?.unknown_count ?? 0
	};
}

async function getSummaryByCategory(
	db: DbClient,
	range: ReportDateRange,
	accountId?: string
): Promise<SummaryReport['byCategory']> {
	const accountClause = accountId ? 'AND t.account_id = ?' : '';
	const { results } = await db
		.prepare(
			`SELECT
				t.category_id,
				COALESCE(c.name, 'Unknown') AS category_name,
				COALESCE(c.type, 'unknown') AS category_type,
				-COALESCE(SUM(CASE WHEN t.amount_cents < 0 THEN t.amount_cents ELSE 0 END), 0) AS expense_cents,
				COALESCE(SUM(CASE WHEN t.amount_cents > 0 THEN t.amount_cents ELSE 0 END), 0) AS income_cents,
				COALESCE(SUM(t.amount_cents), 0) AS net_cents,
				COUNT(*) AS transaction_count
			FROM transactions t
			LEFT JOIN categories c ON c.id = t.category_id
			WHERE t.booking_date BETWEEN ? AND ? ${accountClause}
			GROUP BY t.category_id, c.name, c.type
			ORDER BY expense_cents DESC, income_cents DESC, category_name ASC`
		)
		.bind(
			range.from,
			range.to,
			...(accountId ? [accountId] : [])
		)
		.all<CategorySummaryRow>();

	return results.map((row) => ({
		categoryId: row.category_id,
		categoryName: row.category_name,
		type: row.category_type,
		expenseCents: row.expense_cents,
		incomeCents: row.income_cents,
		netCents: row.net_cents,
		transactionCount: row.transaction_count
	}));
}

async function getSummaryByAccount(
	db: DbClient,
	range: ReportDateRange,
	accountId?: string
): Promise<SummaryReport['byAccount']> {
	const accountClause = accountId ? 'WHERE a.id = ?' : '';
	const [{ results }, balances] = await Promise.all([
		db
			.prepare(
				`SELECT
				a.id AS account_id,
				a.name AS account_name,
				COALESCE(SUM(CASE WHEN t.booking_date BETWEEN ? AND ? AND t.amount_cents > 0 THEN t.amount_cents ELSE 0 END), 0) AS income_cents,
				COALESCE(SUM(CASE WHEN t.booking_date BETWEEN ? AND ? AND t.amount_cents < 0 THEN t.amount_cents ELSE 0 END), 0) AS expense_cents,
				COALESCE(SUM(CASE WHEN t.booking_date BETWEEN ? AND ? THEN t.amount_cents ELSE 0 END), 0) AS net_cents
			FROM accounts a
			LEFT JOIN transactions t ON t.account_id = a.id
			${accountClause}
			GROUP BY a.id, a.name
			ORDER BY a.display_order ASC, a.created_at ASC`
			)
			.bind(
				range.from,
				range.to,
				range.from,
				range.to,
				range.from,
				range.to,
				...(accountId ? [accountId] : [])
			)
			.all<AccountSummaryRow>(),
		listCalculatedAccountBalances(db, range.to, accountId)
	]);

	return results.map((row) => {
		const balance = balances.find((item) => item.accountId === row.account_id);
		return {
			accountId: row.account_id,
			accountName: row.account_name,
			balanceCents: balance?.balanceCents ?? null,
			balanceInitialized: balance?.balanceInitialized ?? false,
			incomeCents: row.income_cents,
			expenseCents: row.expense_cents,
			netCents: row.net_cents
		};
	});
}

async function getRecentTransactions(
	db: DbClient,
	range: ReportDateRange,
	accountId?: string
): Promise<SummaryReport['recentTransactions']> {
	const accountClause = accountId ? 'AND t.account_id = ?' : '';
	const { results } = await db
		.prepare(
			`SELECT
				t.id,
				a.name AS account_name,
				c.name AS category_name,
				t.booking_date,
				t.amount_cents,
				t.payee,
				t.classification_status
			FROM transactions t
			INNER JOIN accounts a ON a.id = t.account_id
			LEFT JOIN categories c ON c.id = t.category_id
			WHERE t.booking_date BETWEEN ? AND ? ${accountClause}
			ORDER BY t.booking_date DESC, t.id DESC
			LIMIT 10`
		)
		.bind(
			range.from,
			range.to,
			...(accountId ? [accountId] : [])
		)
		.all<RecentTransactionRow>();

	return results.map((row) => ({
		id: row.id,
		accountName: row.account_name,
		categoryName: row.category_name,
		bookingDate: row.booking_date,
		amountCents: row.amount_cents,
		payee: row.payee,
		classificationStatus: row.classification_status
	}));
}

async function getCurrentAccountBalances(
	db: DbClient,
	asOfDate: string,
	accountId?: string
): Promise<NetWorthReport['accounts']> {
	return listCalculatedAccountBalances(db, asOfDate, accountId);
}

async function getAssetInputs(
	db: DbClient,
	currentDate: string,
	accountId?: string
): Promise<AssetInputs> {
	const [accounts, transactions, snapshots] = await Promise.all([
		getAssetAccounts(db, accountId),
		getAssetTransactions(db, currentDate, accountId),
		getAssetSnapshots(db, currentDate, accountId)
	]);

	return { accounts, transactions, snapshots };
}

async function getAssetAccounts(db: DbClient, accountId?: string): Promise<AssetAccountRow[]> {
	const accountClause = accountId ? 'WHERE a.id = ?' : '';
	const { results } = await db
		.prepare(
			`SELECT
				a.id AS account_id,
				a.name
			FROM accounts a
			${accountClause}`
		)
		.bind(...(accountId ? [accountId] : []))
		.all<AssetAccountRow>();

	return results;
}

async function getAssetTransactions(
	db: DbClient,
	_currentDate: string,
	accountId?: string
): Promise<AssetTransactionRow[]> {
	const accountClause = accountId ? 'AND t.account_id = ?' : '';
	const { results } = await db
		.prepare(
			`SELECT t.account_id, t.booking_date, t.amount_cents, t.import_batch_id,
				r.import_order, t.created_at, t.id
			FROM transactions t
			LEFT JOIN import_batches b ON b.id = t.import_batch_id
			LEFT JOIN import_runs r ON r.id = b.import_run_id
			WHERE 1 = 1 ${accountClause}
			ORDER BY t.account_id ASC, t.booking_date ASC, t.created_at ASC, t.id ASC`
		)
		.bind(...(accountId ? [accountId] : []))
		.all<AssetTransactionRow>();

	return results;
}

async function getAssetSnapshots(
	db: DbClient,
	_currentDate: string,
	accountId?: string
): Promise<AssetSnapshotRow[]> {
	const accountClause = accountId ? 'AND s.account_id = ?' : '';
	const { results } = await db
		.prepare(
			`SELECT s.account_id, s.snapshot_date, s.balance_cents, s.anchor_import_batch_id,
				r.import_order AS anchor_import_order, s.created_at, s.id
			FROM account_balance_snapshots s
			LEFT JOIN import_batches b ON b.id = s.anchor_import_batch_id
			LEFT JOIN import_runs r ON r.id = b.import_run_id
			WHERE 1 = 1 ${accountClause}
			ORDER BY s.account_id ASC, s.snapshot_date ASC, s.created_at ASC, s.id ASC`
		)
		.bind(...(accountId ? [accountId] : []))
		.all<AssetSnapshotRow>();

	return results;
}

function getAssetsCentsAsOf(inputs: AssetInputs, asOfDate: string, currentDate: string): number {
	return inputs.accounts.reduce(
		(sum, account) => sum + getAccountBalanceAsOf(inputs, account, asOfDate, currentDate),
		0
	);
}

function getAccountBalanceAsOf(
	inputs: AssetInputs,
	account: AssetAccountRow,
	asOfDate: string,
	currentDate: string
): number {
	void currentDate;
	return (
		calculateBalanceAsOf(
			inputs.snapshots
				.filter((row) => row.account_id === account.account_id)
				.map(mapBalanceSnapshot),
			inputs.transactions
				.filter((row) => row.account_id === account.account_id)
				.map(mapBalanceTransaction),
			asOfDate
		) ?? 0
	);
}

async function getActiveLiabilities(
	db: DbClient,
	asOfDate: string,
	accountId?: string
): Promise<NetWorthReport['liabilities']> {
	const accountClause = accountId ? 'AND account_id = ?' : '';
	const { results } = await db
		.prepare(
			`SELECT id, name, amount_cents, as_of_date
			FROM marked_liabilities
			WHERE status = 'active'
				AND as_of_date <= ?
				${accountClause}
			ORDER BY as_of_date DESC, name ASC`
		)
		.bind(asOfDate, ...(accountId ? [accountId] : []))
		.all<LiabilityRow>();

	return results.map((row) => ({
		id: row.id,
		name: row.name,
		amountCents: row.amount_cents,
		asOfDate: row.as_of_date
	}));
}

async function getSnapshotPoints(
	db: DbClient,
	range: ReportDateRange,
	accountId?: string
): Promise<SnapshotPointRow[]> {
	const accountClause = accountId ? 'AND account_id = ?' : '';
	const { results } = await db
		.prepare(
			`SELECT snapshot_date, SUM(balance_cents) AS assets_cents
			FROM account_balance_snapshots
			WHERE snapshot_date BETWEEN ? AND ? ${accountClause}
			GROUP BY snapshot_date
			ORDER BY snapshot_date ASC`
		)
		.bind(range.from, range.to, ...(accountId ? [accountId] : []))
		.all<SnapshotPointRow>();

	return results;
}

async function getBalanceEventDates(
	db: DbClient,
	range: ReportDateRange,
	accountId?: string
): Promise<string[]> {
	const transactionAccountClause = accountId ? 'AND account_id = ?' : '';
	const liabilityAccountClause = accountId ? 'AND account_id = ?' : '';
	const { results } = await db
		.prepare(
			`SELECT booking_date AS date
			FROM transactions
			WHERE booking_date BETWEEN ? AND ? ${transactionAccountClause}
			GROUP BY booking_date
			UNION
			SELECT as_of_date AS date
			FROM marked_liabilities
			WHERE status = 'active'
				AND as_of_date BETWEEN ? AND ?
				${liabilityAccountClause}
			GROUP BY as_of_date
			ORDER BY date ASC`
		)
		.bind(
			range.from,
			range.to,
			...(accountId ? [accountId] : []),
			range.from,
			range.to,
			...(accountId ? [accountId] : [])
		)
		.all<DateRow>();

	return results.map((row) => row.date);
}

function mapBalanceSnapshot(row: AssetSnapshotRow): BalanceSnapshot {
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

function mapBalanceTransaction(row: AssetTransactionRow): BalanceTransaction {
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

function liabilityTotalAsOf(liabilities: NetWorthReport['liabilities'], date: string): number {
	return liabilities
		.filter((liability) => liability.asOfDate <= date)
		.reduce((sum, liability) => sum + liability.amountCents, 0);
}

interface TotalsRow extends DbRow {
	income_cents: number;
	expense_cents: number;
	net_cents: number;
	transaction_count: number;
	unknown_count: number;
}

interface CategorySummaryRow extends DbRow {
	category_id: string | null;
	category_name: string;
	category_type: string;
	expense_cents: number;
	income_cents: number;
	net_cents: number;
	transaction_count: number;
}

interface MonthlyCategorySummaryRow extends DbRow {
	month: string;
	category_id: string | null;
	category_name: string;
	expense_cents: number;
}

interface AccountSummaryRow extends DbRow {
	account_id: string;
	account_name: string;
	income_cents: number;
	expense_cents: number;
	net_cents: number;
}

interface RecentTransactionRow extends DbRow {
	id: string;
	account_name: string;
	category_name: string | null;
	booking_date: string;
	amount_cents: number;
	payee: string | null;
	classification_status: string;
}

interface AssetAccountRow extends DbRow {
	account_id: string;
	name: string;
}

interface AssetInputs {
	accounts: AssetAccountRow[];
	transactions: AssetTransactionRow[];
	snapshots: AssetSnapshotRow[];
}

interface AssetTransactionRow extends DbRow {
	account_id: string;
	booking_date: string;
	amount_cents: number;
	import_batch_id: string | null;
	import_order: number | null;
	created_at: string;
	id: string;
}

interface AssetSnapshotRow extends DbRow {
	account_id: string;
	snapshot_date: string;
	balance_cents: number;
	anchor_import_batch_id: string | null;
	anchor_import_order: number | null;
	created_at: string;
	id: string;
}

interface LiabilityRow extends DbRow {
	id: string;
	name: string;
	amount_cents: number;
	as_of_date: string;
}

interface DateRow extends DbRow {
	date: string;
}

interface SnapshotPointRow extends DbRow {
	snapshot_date: string;
	assets_cents: number;
}
