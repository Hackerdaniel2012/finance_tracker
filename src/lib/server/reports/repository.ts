import { NotFoundError } from '../accounts/errors';
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
	const accountId = options?.accountId;
	const [totals, byCategory, byAccount, recentTransactions] = await Promise.all([
		getSummaryTotals(db, range, accountId),
		getSummaryByCategory(db, range, accountId),
		getSummaryByAccount(db, range, accountId),
		getRecentTransactions(db, range, accountId)
	]);

	return {
		range,
		totals,
		byCategory,
		byAccount,
		recentTransactions
	};
}

export async function getNetWorthReport(
	db: DbClient,
	range: ReportDateRange,
	options?: NetWorthReportOptions
): Promise<NetWorthReport> {
	const accountId = options?.accountId;
	const [accounts, liabilities, snapshotRows, balanceEventDates, assetInputs] = await Promise.all([
		getCurrentAccountBalances(db, range.to, accountId),
		getActiveLiabilities(db, range.to, accountId),
		getSnapshotPoints(db, range, accountId),
		getBalanceEventDates(db, range, accountId),
		getAssetInputs(db, range.to, accountId)
	]);
	const currentAssetsCents = accounts.reduce((sum, account) => sum + account.balanceCents, 0);
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
		getAssetSnapshotsForAccount(db, accountId, range.to),
		getAssetTransactionsForAccount(db, accountId, range.to)
	]);

	if (!account) {
		throw new NotFoundError('Account not found');
	}

	const inputs: AssetInputs = { accounts: [account], transactions, snapshots };
	const eventDates = [
		...new Set([
			range.from,
			...snapshots.map((snapshot) => snapshot.snapshot_date),
			...transactions.map((transaction) => transaction.booking_date),
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
				name,
				opening_balance_cents,
				current_balance_cents
			FROM accounts
			WHERE id = ?`
		)
		.bind(accountId)
		.first<AssetAccountRow>();
}

async function getAssetSnapshotsForAccount(
	db: DbClient,
	accountId: string,
	currentDate: string
): Promise<AssetSnapshotRow[]> {
	const { results } = await db
		.prepare(
			`SELECT account_id, snapshot_date, balance_cents, created_at, id
			FROM account_balance_snapshots
			WHERE account_id = ? AND snapshot_date <= ?
			ORDER BY snapshot_date ASC, created_at ASC, id ASC`
		)
		.bind(accountId, currentDate)
		.all<AssetSnapshotRow>();

	return results;
}

async function getAssetTransactionsForAccount(
	db: DbClient,
	accountId: string,
	currentDate: string
): Promise<AssetTransactionRow[]> {
	const { results } = await db
		.prepare(
			`SELECT account_id, booking_date, amount_cents, balance_after_cents, created_at, id
			FROM transactions
			WHERE account_id = ? AND booking_date <= ?
			ORDER BY booking_date ASC, created_at ASC, id ASC`
		)
		.bind(accountId, currentDate)
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
		.bind(range.from, range.to, ...(accountId ? [accountId] : []))
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
				SUM(t.amount_cents) AS amount_cents,
				COUNT(*) AS transaction_count
			FROM transactions t
			LEFT JOIN categories c ON c.id = t.category_id
			WHERE t.booking_date BETWEEN ? AND ? ${accountClause}
			GROUP BY t.category_id, c.name, c.type
			ORDER BY ABS(SUM(t.amount_cents)) DESC, category_name ASC`
		)
		.bind(range.from, range.to, ...(accountId ? [accountId] : []))
		.all<CategorySummaryRow>();

	return results.map((row) => ({
		categoryId: row.category_id,
		categoryName: row.category_name,
		type: row.category_type,
		amountCents: row.amount_cents,
		transactionCount: row.transaction_count
	}));
}

async function getSummaryByAccount(
	db: DbClient,
	range: ReportDateRange,
	accountId?: string
): Promise<SummaryReport['byAccount']> {
	const accountClause = accountId ? 'WHERE a.id = ?' : '';
	const { results } = await db
		.prepare(
			`SELECT
				a.id AS account_id,
				a.name AS account_name,
				a.opening_balance_cents,
				a.current_balance_cents,
				COALESCE(SUM(CASE WHEN t.booking_date <= ? THEN t.amount_cents ELSE 0 END), 0) AS net_to_date_cents,
				COALESCE(SUM(CASE WHEN t.booking_date BETWEEN ? AND ? AND t.amount_cents > 0 THEN t.amount_cents ELSE 0 END), 0) AS income_cents,
				COALESCE(SUM(CASE WHEN t.booking_date BETWEEN ? AND ? AND t.amount_cents < 0 THEN t.amount_cents ELSE 0 END), 0) AS expense_cents,
				COALESCE(SUM(CASE WHEN t.booking_date BETWEEN ? AND ? THEN t.amount_cents ELSE 0 END), 0) AS net_cents
			FROM accounts a
			LEFT JOIN transactions t ON t.account_id = a.id
			${accountClause}
			GROUP BY a.id, a.name, a.opening_balance_cents, a.current_balance_cents
			ORDER BY a.display_order ASC, a.created_at ASC`
		)
		.bind(
			range.to,
			range.from,
			range.to,
			range.from,
			range.to,
			range.from,
			range.to,
			...(accountId ? [accountId] : [])
		)
		.all<AccountSummaryRow>();

	return results.map((row) => ({
		accountId: row.account_id,
		accountName: row.account_name,
		balanceCents: row.current_balance_cents ?? row.opening_balance_cents + row.net_to_date_cents,
		incomeCents: row.income_cents,
		expenseCents: row.expense_cents,
		netCents: row.net_cents
	}));
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
		.bind(range.from, range.to, ...(accountId ? [accountId] : []))
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
	const accountClause = accountId ? 'WHERE a.id = ?' : '';
	const { results } = await db
		.prepare(
			`SELECT
				a.id AS account_id,
				a.name AS account_name,
				a.opening_balance_cents,
				a.current_balance_cents,
				COALESCE(SUM(CASE WHEN t.booking_date <= ? THEN t.amount_cents ELSE 0 END), 0) AS net_to_date_cents
			FROM accounts a
			LEFT JOIN transactions t ON t.account_id = a.id
			${accountClause}
			GROUP BY a.id, a.name, a.opening_balance_cents, a.current_balance_cents
			ORDER BY a.display_order ASC, a.created_at ASC`
		)
		.bind(asOfDate, ...(accountId ? [accountId] : []))
		.all<AccountBalanceRow>();

	return results.map((row) => ({
		accountId: row.account_id,
		accountName: row.account_name,
		balanceCents: row.current_balance_cents ?? row.opening_balance_cents + row.net_to_date_cents
	}));
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
				a.name,
				a.opening_balance_cents,
				a.current_balance_cents
			FROM accounts a
			${accountClause}`
		)
		.bind(...(accountId ? [accountId] : []))
		.all<AssetAccountRow>();

	return results;
}

async function getAssetTransactions(
	db: DbClient,
	currentDate: string,
	accountId?: string
): Promise<AssetTransactionRow[]> {
	const accountClause = accountId ? 'AND account_id = ?' : '';
	const { results } = await db
		.prepare(
			`SELECT account_id, booking_date, amount_cents, balance_after_cents, created_at, id
			FROM transactions
			WHERE booking_date <= ? ${accountClause}
			ORDER BY account_id ASC, booking_date ASC, created_at ASC, id ASC`
		)
		.bind(currentDate, ...(accountId ? [accountId] : []))
		.all<AssetTransactionRow>();

	return results;
}

async function getAssetSnapshots(
	db: DbClient,
	currentDate: string,
	accountId?: string
): Promise<AssetSnapshotRow[]> {
	const accountClause = accountId ? 'AND account_id = ?' : '';
	const { results } = await db
		.prepare(
			`SELECT account_id, snapshot_date, balance_cents, created_at, id
			FROM account_balance_snapshots
			WHERE snapshot_date <= ? ${accountClause}
			ORDER BY account_id ASC, snapshot_date ASC, created_at ASC, id ASC`
		)
		.bind(currentDate, ...(accountId ? [accountId] : []))
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
	const accountTransactions = inputs.transactions.filter(
		(transaction) => transaction.account_id === account.account_id
	);
	const balanceAfter = latestBalanceAfterTransaction(accountTransactions, asOfDate);
	if (balanceAfter) {
		return (
			balanceAfter.balance_after_cents +
			transactionDelta(accountTransactions, balanceAfter.booking_date, asOfDate)
		);
	}

	const snapshot = latestAccountSnapshot(
		inputs.snapshots.filter((row) => row.account_id === account.account_id),
		asOfDate
	);
	if (snapshot) {
		return (
			snapshot.balance_cents +
			transactionDelta(accountTransactions, snapshot.snapshot_date, asOfDate)
		);
	}

	if (account.current_balance_cents !== null) {
		return (
			account.current_balance_cents - transactionDelta(accountTransactions, asOfDate, currentDate)
		);
	}

	return account.opening_balance_cents + transactionDeltaFromStart(accountTransactions, asOfDate);
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

function latestBalanceAfterTransaction(
	transactions: AssetTransactionRow[],
	asOfDate: string
): AssetBalanceAfterRow | null {
	for (let index = transactions.length - 1; index >= 0; index -= 1) {
		const transaction = transactions[index];
		if (transaction.booking_date <= asOfDate && transaction.balance_after_cents !== null) {
			return { ...transaction, balance_after_cents: transaction.balance_after_cents };
		}
	}

	return null;
}

function latestAccountSnapshot(
	snapshots: AssetSnapshotRow[],
	asOfDate: string
): AssetSnapshotRow | null {
	return snapshots.filter((snapshot) => snapshot.snapshot_date <= asOfDate).at(-1) ?? null;
}

function transactionDelta(
	transactions: AssetTransactionRow[],
	fromExclusive: string,
	toInclusive: string
): number {
	return transactions
		.filter(
			(transaction) =>
				transaction.booking_date > fromExclusive && transaction.booking_date <= toInclusive
		)
		.reduce((sum, transaction) => sum + transaction.amount_cents, 0);
}

function transactionDeltaFromStart(
	transactions: AssetTransactionRow[],
	toInclusive: string
): number {
	return transactions
		.filter((transaction) => transaction.booking_date <= toInclusive)
		.reduce((sum, transaction) => sum + transaction.amount_cents, 0);
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
	amount_cents: number;
	transaction_count: number;
}

interface AccountSummaryRow extends DbRow {
	account_id: string;
	account_name: string;
	opening_balance_cents: number;
	current_balance_cents: number | null;
	net_to_date_cents: number;
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

interface AccountBalanceRow extends DbRow {
	account_id: string;
	account_name: string;
	opening_balance_cents: number;
	current_balance_cents: number | null;
	net_to_date_cents: number;
}

interface AssetAccountRow extends DbRow {
	account_id: string;
	name: string;
	opening_balance_cents: number;
	current_balance_cents: number | null;
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
	balance_after_cents: number | null;
	created_at: string;
	id: string;
}

interface AssetBalanceAfterRow extends AssetTransactionRow {
	balance_after_cents: number;
}

interface AssetSnapshotRow extends DbRow {
	account_id: string;
	snapshot_date: string;
	balance_cents: number;
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
