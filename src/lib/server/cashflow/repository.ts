import type { DbClient, DbRow } from '../db-client';
import type {
	BalanceBeforeSalaryAccountProjection,
	BalanceBeforeSalaryProjection,
	CashflowWindow,
	MonthCashflowReport,
	UpcomingIncome,
	UpcomingPayment
} from './types';
import type { RecurringCadence } from '../recurring/types';

export async function getMonthCashflowReport(
	db: DbClient,
	window: CashflowWindow
): Promise<MonthCashflowReport> {
	const from = startOfMonth(window.asOf);
	const accountClause = window.accountId ? 'AND account_id = ?' : '';
	const subaccountClause = window.subaccount ? 'AND subaccount = ?' : '';
	const [actualRow, upcomingPayments, upcomingIncome] = await Promise.all([
		db
			.prepare(
				`SELECT
					COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END), 0) AS income_cents,
					COALESCE(SUM(CASE WHEN amount_cents < 0 THEN amount_cents ELSE 0 END), 0) AS expense_cents,
					COALESCE(SUM(amount_cents), 0) AS net_cents
				FROM transactions
				WHERE booking_date BETWEEN ? AND ? ${accountClause} ${subaccountClause}`
			)
			.bind(
				from,
				window.asOf,
				...(window.accountId ? [window.accountId] : []),
				...(window.subaccount ? [window.subaccount] : [])
			)
			.first<MonthActualRow>(),
		getUpcomingPayments(db, window),
		getUpcomingIncome(db, window)
	]);
	const actual = {
		incomeCents: actualRow?.income_cents ?? 0,
		expenseCents: actualRow?.expense_cents ?? 0,
		netCents: actualRow?.net_cents ?? 0
	};
	const incomeCents = upcomingIncome.reduce((sum, income) => sum + income.amountCents, 0);
	const paymentCents = upcomingPayments.reduce((sum, payment) => sum + payment.amountCents, 0);
	const forecast = {
		incomeCents,
		paymentCents,
		netCents: incomeCents - paymentCents
	};

	return {
		range: { from, asOf: window.asOf, to: window.monthEnd },
		actual,
		forecast,
		projectedNetCents: actual.netCents + forecast.netCents,
		upcomingPayments,
		upcomingIncome
	};
}

export async function getUpcomingPayments(
	db: DbClient,
	window: CashflowWindow
): Promise<UpcomingPayment[]> {
	const [plannedPayments, contractPayments, recurringPayments] = await Promise.all([
		getPlannedPayments(db, window),
		getContractPayments(db, window),
		getRecurringPayments(db, window)
	]);

	return [...plannedPayments, ...contractPayments, ...recurringPayments].sort(comparePayments);
}

export async function getUpcomingIncome(
	db: DbClient,
	window: CashflowWindow
): Promise<UpcomingIncome[]> {
	const [plannedIncome, contractIncome] = await Promise.all([
		getPlannedIncome(db, window),
		getContractIncome(db, window)
	]);

	return [...plannedIncome, ...contractIncome].sort(compareIncome);
}

export async function getBalanceBeforeSalaryProjection(
	db: DbClient,
	window: CashflowWindow
): Promise<BalanceBeforeSalaryProjection> {
	const [nextIncome, accountBalances] = await Promise.all([
		getNextIncome(db, window),
		getAccountBalances(db, window.asOf, window.accountId, window.subaccount)
	]);
	const salaryDate = window.nextSalaryDate ?? nextIncome?.dueDate ?? null;
	const projectionDate = salaryDate ? previousDate(salaryDate) : window.monthEnd;
	const upcomingPayments = await getPaymentsThroughDate(
		db,
		window.asOf,
		projectionDate,
		window.accountId
	);
	const upcomingPaymentCents = upcomingPayments.reduce(
		(sum, payment) => sum + payment.amountCents,
		0
	);
	const currentBalanceCents = accountBalances.reduce(
		(sum, account) => sum + account.current_balance_cents,
		0
	);
	const accountProjections = accountBalances.map((account) =>
		mapAccountProjection(account, upcomingPayments)
	);

	return {
		asOf: window.asOf,
		projectionDate,
		manualNextSalaryDate: window.nextSalaryDate,
		nextIncome,
		currentBalanceCents,
		upcomingPaymentCents,
		projectedBalanceCents: currentBalanceCents - upcomingPaymentCents,
		upcomingPayments,
		accountProjections
	};
}

async function getPlannedPayments(
	db: DbClient,
	window: CashflowWindow
): Promise<UpcomingPayment[]> {
	const accountClause = window.accountId ? 'AND p.account_id = ?' : '';
	const { results } = await db
		.prepare(
			`${plannedPaymentSelect()}
			WHERE p.status = 'planned'
				AND p.due_date BETWEEN ? AND ?
				${accountClause}`
		)
		.bind(window.asOf, window.monthEnd, ...(window.accountId ? [window.accountId] : []))
		.all<UpcomingPaymentRow>();

	return results.map(mapUpcomingPayment);
}

async function getPlannedIncome(db: DbClient, window: CashflowWindow): Promise<UpcomingIncome[]> {
	const accountClause = window.accountId ? 'AND i.account_id = ?' : '';
	const { results } = await db
		.prepare(
			`${plannedIncomeSelect()}
			WHERE i.status = 'planned'
				AND i.due_date BETWEEN ? AND ?
				${accountClause}`
		)
		.bind(window.asOf, window.monthEnd, ...(window.accountId ? [window.accountId] : []))
		.all<UpcomingIncomeRow>();

	return results.map(mapUpcomingIncome);
}

async function getContractPayments(
	db: DbClient,
	window: CashflowWindow
): Promise<UpcomingPayment[]> {
	const accountClause = window.accountId ? 'AND c.account_id = ?' : '';
	const { results } = await db
		.prepare(
			`${contractPaymentSelect()}
			WHERE c.status = 'active'
				AND c.kind IN ('fixed_cost', 'subscription', 'other')
				AND c.next_date BETWEEN ? AND ?
				${accountClause}`
		)
		.bind(window.asOf, window.monthEnd, ...(window.accountId ? [window.accountId] : []))
		.all<ContractPaymentRow>();

	return results.map(mapContractPayment);
}

async function getRecurringPayments(
	db: DbClient,
	window: CashflowWindow
): Promise<UpcomingPayment[]> {
	const accountClause = window.accountId ? 'AND rg.account_id = ?' : '';
	const { results } = await db
		.prepare(
			`${recurringPaymentSelect()}
			WHERE rg.status = 'confirmed'
				AND rg.next_date IS NOT NULL
				AND rg.next_date <= ?
				AND COALESCE(c.type, 'expense') != 'income'
				${accountClause}`
		)
		.bind(window.monthEnd, ...(window.accountId ? [window.accountId] : []))
		.all<RecurringPaymentRow>();

	return results.flatMap((row) => expandRecurringPayment(row, window.asOf, window.monthEnd));
}

async function getContractIncome(db: DbClient, window: CashflowWindow): Promise<UpcomingIncome[]> {
	const accountClause = window.accountId ? 'AND c.account_id = ?' : '';
	const { results } = await db
		.prepare(
			`${contractIncomeSelect()}
			WHERE c.status = 'active'
				AND c.kind IN ('salary', 'income')
				AND c.next_date BETWEEN ? AND ?
				${accountClause}`
		)
		.bind(window.asOf, window.monthEnd, ...(window.accountId ? [window.accountId] : []))
		.all<ContractIncomeRow>();

	return results.map(mapContractIncome);
}

async function getNextIncome(db: DbClient, window: CashflowWindow): Promise<UpcomingIncome | null> {
	const [nextIncome] = await getContractIncome(db, window);
	return nextIncome ?? null;
}

async function getPaymentsThroughDate(
	db: DbClient,
	from: string,
	to: string,
	accountId?: string
): Promise<UpcomingPayment[]> {
	if (to < from) {
		return [];
	}

	const payments = await getUpcomingPayments(db, {
		asOf: from,
		monthEnd: to,
		nextSalaryDate: null,
		accountId
	});
	return payments.filter((payment) => payment.dueDate <= to);
}

async function getAccountBalances(
	db: DbClient,
	asOf: string,
	accountId?: string,
	subaccount?: string
): Promise<AccountBalanceRow[]> {
	const accountFilter = accountId ? 'WHERE account_id = ?' : '';
	const subaccountClause = subaccount ? 'AND t.subaccount = ?' : '';
	const { results } = await db
		.prepare(
			`SELECT
				account_id,
				account_name,
				balance_cents AS current_balance_cents
			FROM (
				SELECT
					a.id AS account_id,
					a.name AS account_name,
					CASE
						WHEN ? IS NOT NULL THEN a.opening_balance_cents + COALESCE(SUM(t.amount_cents), 0)
						WHEN a.current_balance_cents IS NOT NULL THEN a.current_balance_cents
						ELSE a.opening_balance_cents + COALESCE(SUM(t.amount_cents), 0)
					END AS balance_cents,
					a.display_order,
					a.created_at,
					MIN(a.rowid) AS row_id
				FROM accounts a
				LEFT JOIN transactions t ON t.account_id = a.id AND t.booking_date <= ? ${subaccountClause}
				GROUP BY a.id, a.name, a.opening_balance_cents, a.current_balance_cents, a.display_order, a.created_at
			)
			${accountFilter}
			ORDER BY display_order ASC, created_at ASC, row_id ASC`
		)
		.bind(
			subaccount ?? null,
			asOf,
			...(subaccount ? [subaccount] : []),
			...(accountId ? [accountId] : [])
		)
		.all<AccountBalanceRow>();

	return results;
}

function plannedPaymentSelect(): string {
	return `SELECT
		p.id, p.account_id, a.name AS account_name, p.category_id, c.name AS category_name,
		p.payee, p.amount_cents, p.due_date, p.note
	FROM planned_payments p
	LEFT JOIN accounts a ON a.id = p.account_id
	LEFT JOIN categories c ON c.id = p.category_id`;
}

function plannedIncomeSelect(): string {
	return `SELECT
		i.id, i.account_id, a.name AS account_name, i.category_id, c.name AS category_name,
		i.payer, i.amount_cents, i.due_date, i.note
	FROM planned_income i
	LEFT JOIN accounts a ON a.id = i.account_id
	LEFT JOIN categories c ON c.id = i.category_id`;
}

function contractPaymentSelect(): string {
	return `SELECT
		c.id, c.account_id, a.name AS account_name, c.category_id, cat.name AS category_name,
		COALESCE(c.payee, c.name) AS payee, c.expected_amount_cents AS amount_cents,
		c.next_date AS due_date
	FROM contracts c
	LEFT JOIN accounts a ON a.id = c.account_id
	LEFT JOIN categories cat ON cat.id = c.category_id`;
}

function recurringPaymentSelect(): string {
	return `SELECT
		rg.id, rg.account_id, a.name AS account_name, rg.category_id, c.name AS category_name,
		rg.payee, rg.cadence, rg.expected_amount_cents AS amount_cents, rg.next_date AS due_date
	FROM recurring_groups rg
	LEFT JOIN accounts a ON a.id = rg.account_id
	LEFT JOIN categories c ON c.id = rg.category_id`;
}

function contractIncomeSelect(): string {
	return `SELECT
		c.id, c.account_id, a.name AS account_name, c.category_id, cat.name AS category_name,
		COALESCE(c.payee, c.name) AS payer, c.expected_amount_cents AS amount_cents,
		c.next_date AS due_date
	FROM contracts c
	LEFT JOIN accounts a ON a.id = c.account_id
	LEFT JOIN categories cat ON cat.id = c.category_id`;
}

function mapUpcomingPayment(row: UpcomingPaymentRow): UpcomingPayment {
	return {
		id: row.id,
		accountId: row.account_id,
		accountName: row.account_name,
		categoryId: row.category_id,
		categoryName: row.category_name,
		payee: row.payee,
		amountCents: row.amount_cents,
		dueDate: row.due_date,
		note: row.note
	};
}

function mapUpcomingIncome(row: UpcomingIncomeRow): UpcomingIncome {
	return {
		id: row.id,
		accountId: row.account_id,
		accountName: row.account_name,
		categoryId: row.category_id,
		categoryName: row.category_name,
		payer: row.payer,
		amountCents: row.amount_cents,
		dueDate: row.due_date,
		note: row.note
	};
}

function mapContractPayment(row: ContractPaymentRow): UpcomingPayment {
	return {
		id: row.id,
		accountId: row.account_id,
		accountName: row.account_name,
		categoryId: row.category_id,
		categoryName: row.category_name,
		payee: row.payee,
		amountCents: row.amount_cents,
		dueDate: row.due_date,
		note: null
	};
}

function mapRecurringPayment(row: RecurringPaymentRow): UpcomingPayment {
	return {
		id: row.id,
		accountId: row.account_id,
		accountName: row.account_name,
		categoryId: row.category_id,
		categoryName: row.category_name,
		payee: row.payee,
		amountCents: row.amount_cents,
		dueDate: row.due_date,
		note: null
	};
}

function expandRecurringPayment(
	row: RecurringPaymentRow,
	from: string,
	to: string
): UpcomingPayment[] {
	const payments: UpcomingPayment[] = [];
	let dueDate = row.due_date;

	while (dueDate < from) {
		dueDate = nextCadenceDate(dueDate, row.cadence);
	}

	while (dueDate <= to) {
		payments.push({
			...mapRecurringPayment(row),
			id: `${row.id}:${dueDate}`,
			dueDate
		});
		dueDate = nextCadenceDate(dueDate, row.cadence);
	}

	return payments;
}

function mapContractIncome(row: ContractIncomeRow): UpcomingIncome {
	return {
		id: row.id,
		accountId: row.account_id,
		accountName: row.account_name,
		categoryId: row.category_id,
		categoryName: row.category_name,
		payer: row.payer,
		amountCents: row.amount_cents,
		dueDate: row.due_date,
		note: null
	};
}

function comparePayments(a: UpcomingPayment, b: UpcomingPayment): number {
	return a.dueDate.localeCompare(b.dueDate) || a.payee.localeCompare(b.payee);
}

function compareIncome(a: UpcomingIncome, b: UpcomingIncome): number {
	return a.dueDate.localeCompare(b.dueDate) || a.payer.localeCompare(b.payer);
}

function mapAccountProjection(
	account: AccountBalanceRow,
	upcomingPayments: UpcomingPayment[]
): BalanceBeforeSalaryAccountProjection {
	const upcomingPaymentCents = upcomingPayments
		.filter((payment) => payment.accountId === account.account_id)
		.reduce((sum, payment) => sum + payment.amountCents, 0);

	return {
		accountId: account.account_id,
		accountName: account.account_name,
		currentBalanceCents: account.current_balance_cents,
		upcomingPaymentCents,
		projectedBalanceCents: account.current_balance_cents - upcomingPaymentCents
	};
}

function previousDate(isoDate: string): string {
	const date = new Date(`${isoDate}T00:00:00.000Z`);
	date.setUTCDate(date.getUTCDate() - 1);
	return date.toISOString().slice(0, 10);
}

function startOfMonth(isoDate: string): string {
	return `${isoDate.slice(0, 7)}-01`;
}

function nextCadenceDate(isoDate: string, cadence: RecurringCadence): string {
	const date = new Date(`${isoDate}T00:00:00.000Z`);
	switch (cadence) {
		case 'weekly':
			date.setUTCDate(date.getUTCDate() + 7);
			break;
		case 'biweekly':
			date.setUTCDate(date.getUTCDate() + 14);
			break;
		case 'monthly':
			date.setUTCMonth(date.getUTCMonth() + 1);
			break;
		case 'quarterly':
			date.setUTCMonth(date.getUTCMonth() + 3);
			break;
		case 'yearly':
			date.setUTCFullYear(date.getUTCFullYear() + 1);
			break;
	}

	return date.toISOString().slice(0, 10);
}

interface UpcomingPaymentRow extends DbRow {
	id: string;
	account_id: string | null;
	account_name: string | null;
	category_id: string | null;
	category_name: string | null;
	payee: string;
	amount_cents: number;
	due_date: string;
	note: string | null;
}

interface MonthActualRow extends DbRow {
	income_cents: number;
	expense_cents: number;
	net_cents: number;
}

interface UpcomingIncomeRow extends DbRow {
	id: string;
	account_id: string | null;
	account_name: string | null;
	category_id: string | null;
	category_name: string | null;
	payer: string;
	amount_cents: number;
	due_date: string;
	note: string | null;
}

interface ContractPaymentRow extends DbRow {
	id: string;
	account_id: string | null;
	account_name: string | null;
	category_id: string | null;
	category_name: string | null;
	payee: string;
	amount_cents: number;
	due_date: string;
}

interface RecurringPaymentRow extends DbRow {
	id: string;
	account_id: string | null;
	account_name: string | null;
	category_id: string | null;
	category_name: string | null;
	payee: string;
	cadence: RecurringCadence;
	amount_cents: number;
	due_date: string;
}

interface ContractIncomeRow extends DbRow {
	id: string;
	account_id: string | null;
	account_name: string | null;
	category_id: string | null;
	category_name: string | null;
	payer: string;
	amount_cents: number;
	due_date: string;
}

interface AccountBalanceRow extends DbRow {
	account_id: string;
	account_name: string;
	current_balance_cents: number;
}
