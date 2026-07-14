import { occurrenceDate } from '$lib/plans/cadence';
import type { DbClient, DbRow } from '../db-client';
import type { PlanCadence } from '../plans/types';
import type {
	BalanceBeforeIncomeAccountProjection,
	BalanceBeforeIncomeProjection,
	CashflowWindow,
	MonthCashflowReport,
	UpcomingIncome,
	UpcomingPayment
} from './types';

export async function getMonthCashflowReport(
	db: DbClient,
	window: CashflowWindow
): Promise<MonthCashflowReport> {
	const from = `${window.asOf.slice(0, 7)}-01`;
	const accountClause = window.accountId ? 'AND account_id = ?' : '';
	const subaccountClause = window.subaccount ? 'AND subaccount = ?' : '';
	const [actual, payments, income] = await Promise.all([
		db
			.prepare(
				`SELECT
					COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END), 0) income_cents,
					COALESCE(SUM(CASE WHEN amount_cents < 0 THEN amount_cents ELSE 0 END), 0) expense_cents,
					COALESCE(SUM(amount_cents), 0) net_cents
				FROM transactions
				WHERE booking_date BETWEEN ? AND ? ${accountClause} ${subaccountClause}`
			)
			.bind(
				from,
				window.asOf,
				...(window.accountId ? [window.accountId] : []),
				...(window.subaccount ? [window.subaccount] : [])
			)
			.first<ActualRow>(),
		getUpcomingPayments(db, window),
		getUpcomingIncome(db, window)
	]);
	const incomeCents = income.reduce((sum, item) => sum + item.amountCents, 0);
	const paymentCents = payments.reduce((sum, item) => sum + item.amountCents, 0);
	return {
		range: { from, asOf: window.asOf, to: window.monthEnd },
		actual: {
			incomeCents: actual?.income_cents ?? 0,
			expenseCents: actual?.expense_cents ?? 0,
			netCents: actual?.net_cents ?? 0
		},
		forecast: {
			incomeCents,
			paymentCents,
			netCents: incomeCents - paymentCents
		},
		projectedNetCents: (actual?.net_cents ?? 0) + incomeCents - paymentCents,
		upcomingPayments: payments,
		upcomingIncome: income
	};
}

export async function getUpcomingPayments(
	db: DbClient,
	window: CashflowWindow
): Promise<UpcomingPayment[]> {
	return (await expandedPlans(db, window, 'expense'))
		.map((item) => ({ ...item, payee: item.counterparty ?? item.label ?? '' }))
		.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.payee.localeCompare(b.payee));
}

export async function getUpcomingIncome(
	db: DbClient,
	window: CashflowWindow
): Promise<UpcomingIncome[]> {
	return (await expandedPlans(db, window, 'income'))
		.map((item) => ({ ...item, payer: item.counterparty ?? item.label ?? '' }))
		.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.payer.localeCompare(b.payer));
}

export async function getBalanceBeforeIncomeProjection(
	db: DbClient,
	window: CashflowWindow
): Promise<BalanceBeforeIncomeProjection> {
	const [income, balances] = await Promise.all([
		getUpcomingIncome(db, { ...window, monthEnd: farFuture(window.asOf) }),
		getAccountBalances(db, window.asOf, window.accountId, window.subaccount)
	]);
	const nextIncome = income[0] ?? null;
	const incomeDate = window.nextIncomeDate ?? nextIncome?.dueDate ?? null;
	const projectionDate = incomeDate ? previousDate(incomeDate) : window.monthEnd;
	const payments = await getUpcomingPayments(db, { ...window, monthEnd: projectionDate });
	const currentBalanceCents = balances.reduce(
		(sum, account) => sum + account.current_balance_cents,
		0
	);
	const upcomingPaymentCents = payments.reduce((sum, payment) => sum + payment.amountCents, 0);
	return {
		asOf: window.asOf,
		projectionDate,
		manualNextIncomeDate: window.nextIncomeDate,
		nextIncome,
		currentBalanceCents,
		upcomingPaymentCents,
		projectedBalanceCents: currentBalanceCents - upcomingPaymentCents,
		upcomingPayments: payments,
		accountProjections: balances.map((account) => mapAccountProjection(account, payments))
	};
}

async function expandedPlans(
	db: DbClient,
	window: CashflowWindow,
	direction: 'expense' | 'income'
): Promise<ExpandedPlan[]> {
	const accountClause = window.accountId ? 'AND p.account_id = ?' : '';
	const { results } = await db
		.prepare(
			`SELECT p.*, a.name account_name, c.name category_name
			FROM plans p
			LEFT JOIN accounts a ON a.id = p.account_id
			LEFT JOIN categories c ON c.id = p.category_id
			WHERE p.status = 'active' AND p.direction = ? AND p.next_date <= ? ${accountClause}`
		)
		.bind(direction, window.monthEnd, ...(window.accountId ? [window.accountId] : []))
		.all<PlanRow>();
	return results.flatMap((plan) => expandPlan(plan, window.asOf, window.monthEnd));
}

function expandPlan(plan: PlanRow, from: string, to: string): ExpandedPlan[] {
	if (plan.cadence === 'once')
		return plan.next_date >= from && plan.next_date <= to ? [mapPlan(plan, plan.next_date)] : [];

	const anchor = plan.schedule_anchor_date ?? plan.next_date;
	let index = plan.schedule_occurrence_index;
	let date = occurrenceDate(anchor, plan.cadence, index);
	while (date < from) {
		index += 1;
		date = occurrenceDate(anchor, plan.cadence, index);
	}
	const result: ExpandedPlan[] = [];
	while (date <= to && (!plan.end_date || date <= plan.end_date)) {
		result.push(mapPlan(plan, date));
		index += 1;
		date = occurrenceDate(anchor, plan.cadence, index);
	}
	return result;
}

function mapPlan(plan: PlanRow, dueDate: string): ExpandedPlan {
	return {
		id: `${plan.id}:${dueDate}`,
		accountId: plan.account_id,
		accountName: plan.account_name,
		categoryId: plan.category_id,
		categoryName: plan.category_name,
		counterparty: plan.counterparty,
		label: plan.label,
		amountCents: plan.amount_cents,
		dueDate,
		note: plan.note
	};
}

async function getAccountBalances(
	db: DbClient,
	asOf: string,
	accountId?: string,
	subaccount?: string
): Promise<AccountBalanceRow[]> {
	const filter = accountId ? 'WHERE account_id = ?' : '';
	const subaccountJoin = subaccount ? 'AND t.subaccount = ?' : '';
	const { results } = await db
		.prepare(
			`SELECT account_id, account_name, balance_cents current_balance_cents
			FROM (
				SELECT a.id account_id, a.name account_name,
					CASE
						WHEN ? IS NOT NULL THEN a.opening_balance_cents + COALESCE(SUM(t.amount_cents), 0)
						WHEN a.current_balance_cents IS NOT NULL THEN a.current_balance_cents
						ELSE a.opening_balance_cents + COALESCE(SUM(t.amount_cents), 0)
					END balance_cents,
					a.display_order, a.created_at, MIN(a.rowid) row_id
				FROM accounts a
				LEFT JOIN transactions t ON t.account_id = a.id AND t.booking_date <= ? ${subaccountJoin}
				GROUP BY a.id, a.name, a.opening_balance_cents, a.current_balance_cents,
					a.display_order, a.created_at
			) ${filter}
			ORDER BY display_order, created_at, row_id`
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

function mapAccountProjection(
	account: AccountBalanceRow,
	payments: UpcomingPayment[]
): BalanceBeforeIncomeAccountProjection {
	const upcomingPaymentCents = payments
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

function previousDate(date: string): string {
	const result = new Date(`${date}T00:00:00Z`);
	result.setUTCDate(result.getUTCDate() - 1);
	return result.toISOString().slice(0, 10);
}

function farFuture(date: string): string {
	const result = new Date(`${date}T00:00:00Z`);
	result.setUTCFullYear(result.getUTCFullYear() + 10);
	return result.toISOString().slice(0, 10);
}

interface ActualRow extends DbRow {
	income_cents: number;
	expense_cents: number;
	net_cents: number;
}

interface PlanRow extends DbRow {
	id: string;
	account_id: string | null;
	account_name: string | null;
	category_id: string | null;
	category_name: string | null;
	label: string | null;
	counterparty: string | null;
	cadence: PlanCadence;
	amount_cents: number;
	next_date: string;
	end_date: string | null;
	note: string | null;
	schedule_anchor_date: string | null;
	schedule_occurrence_index: number;
}

interface ExpandedPlan {
	id: string;
	accountId: string | null;
	accountName: string | null;
	categoryId: string | null;
	categoryName: string | null;
	counterparty: string | null;
	label: string | null;
	amountCents: number;
	dueDate: string;
	note: string | null;
}

interface AccountBalanceRow extends DbRow {
	account_id: string;
	account_name: string;
	current_balance_cents: number;
}
