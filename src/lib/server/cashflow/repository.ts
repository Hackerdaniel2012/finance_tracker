import type { DbClient, DbRow } from '../db-client';
import type {
	BalanceBeforeSalaryAccountProjection,
	BalanceBeforeSalaryProjection,
	CashflowWindow,
	UpcomingIncome,
	UpcomingPayment
} from './types';

export async function getUpcomingPayments(
	db: DbClient,
	window: CashflowWindow
): Promise<UpcomingPayment[]> {
	const [plannedPayments, contractPayments, recurringPayments] = await Promise.all([
		getPlannedPayments(db, window.asOf, window.monthEnd),
		getContractPayments(db, window.asOf, window.monthEnd),
		getRecurringPayments(db, window.asOf, window.monthEnd)
	]);

	return [...plannedPayments, ...contractPayments, ...recurringPayments].sort(comparePayments);
}

export async function getUpcomingIncome(
	db: DbClient,
	window: CashflowWindow
): Promise<UpcomingIncome[]> {
	const [plannedIncome, contractIncome] = await Promise.all([
		getPlannedIncome(db, window.asOf, window.monthEnd),
		getContractIncome(db, window.asOf, window.monthEnd)
	]);

	return [...plannedIncome, ...contractIncome].sort(compareIncome);
}

export async function getBalanceBeforeSalaryProjection(
	db: DbClient,
	window: CashflowWindow
): Promise<BalanceBeforeSalaryProjection> {
	const [nextIncome, accountBalances] = await Promise.all([
		getNextIncome(db, window),
		getAccountBalances(db, window.asOf)
	]);
	const projectionDate = nextIncome ? previousDate(nextIncome.dueDate) : window.monthEnd;
	const upcomingPayments = await getPaymentsThroughDate(db, window.asOf, projectionDate);
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
	from: string,
	to: string
): Promise<UpcomingPayment[]> {
	const { results } = await db
		.prepare(
			`${plannedPaymentSelect()}
			WHERE p.status = 'planned'
				AND p.due_date BETWEEN ? AND ?`
		)
		.bind(from, to)
		.all<UpcomingPaymentRow>();

	return results.map(mapUpcomingPayment);
}

async function getPlannedIncome(db: DbClient, from: string, to: string): Promise<UpcomingIncome[]> {
	const { results } = await db
		.prepare(
			`${plannedIncomeSelect()}
			WHERE i.status = 'planned'
				AND i.due_date BETWEEN ? AND ?`
		)
		.bind(from, to)
		.all<UpcomingIncomeRow>();

	return results.map(mapUpcomingIncome);
}

async function getContractPayments(
	db: DbClient,
	from: string,
	to: string
): Promise<UpcomingPayment[]> {
	const { results } = await db
		.prepare(
			`${contractPaymentSelect()}
			WHERE c.status = 'active'
				AND c.kind IN ('fixed_cost', 'subscription', 'other')
				AND c.next_date BETWEEN ? AND ?`
		)
		.bind(from, to)
		.all<ContractPaymentRow>();

	return results.map(mapContractPayment);
}

async function getRecurringPayments(
	db: DbClient,
	from: string,
	to: string
): Promise<UpcomingPayment[]> {
	const { results } = await db
		.prepare(
			`${recurringPaymentSelect()}
			WHERE rg.status = 'confirmed'
				AND rg.next_date BETWEEN ? AND ?
				AND COALESCE(c.type, 'expense') != 'income'`
		)
		.bind(from, to)
		.all<RecurringPaymentRow>();

	return results.map(mapRecurringPayment);
}

async function getContractIncome(
	db: DbClient,
	from: string,
	to: string
): Promise<UpcomingIncome[]> {
	const { results } = await db
		.prepare(
			`${contractIncomeSelect()}
			WHERE c.status = 'active'
				AND c.kind IN ('salary', 'income')
				AND c.next_date BETWEEN ? AND ?`
		)
		.bind(from, to)
		.all<ContractIncomeRow>();

	return results.map(mapContractIncome);
}

async function getNextIncome(db: DbClient, window: CashflowWindow): Promise<UpcomingIncome | null> {
	const [nextIncome] = await getUpcomingIncome(db, window);
	return nextIncome ?? null;
}

async function getPaymentsThroughDate(
	db: DbClient,
	from: string,
	to: string
): Promise<UpcomingPayment[]> {
	if (to < from) {
		return [];
	}

	const payments = await getUpcomingPayments(db, { asOf: from, monthEnd: to });
	return payments.filter((payment) => payment.dueDate <= to);
}

async function getAccountBalances(db: DbClient, asOf: string): Promise<AccountBalanceRow[]> {
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
					a.current_balance_cents AS balance_cents,
					a.display_order,
					a.created_at
				FROM accounts a
				WHERE a.current_balance_cents IS NOT NULL
				UNION ALL
				SELECT
					a.id AS account_id,
					a.name AS account_name,
					a.opening_balance_cents + COALESCE(SUM(t.amount_cents), 0) AS balance_cents,
					a.display_order,
					a.created_at
				FROM accounts a
				LEFT JOIN transactions t ON t.account_id = a.id AND t.booking_date <= ?
				WHERE a.current_balance_cents IS NULL
				GROUP BY a.id, a.name, a.opening_balance_cents, a.display_order, a.created_at
			)
			ORDER BY display_order ASC, created_at ASC`
		)
		.bind(asOf)
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
		rg.payee, rg.expected_amount_cents AS amount_cents, rg.next_date AS due_date
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
