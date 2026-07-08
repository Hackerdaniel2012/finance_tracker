import type { DbClient, DbRow } from '../db-client';
import type {
	BalanceBeforeSalaryProjection,
	CashflowWindow,
	UpcomingIncome,
	UpcomingPayment
} from './types';

export async function getUpcomingPayments(
	db: DbClient,
	window: CashflowWindow
): Promise<UpcomingPayment[]> {
	const { results } = await db
		.prepare(
			`${plannedPaymentSelect()}
			WHERE p.status = 'planned'
				AND p.due_date BETWEEN ? AND ?
			ORDER BY p.due_date ASC, p.payee ASC`
		)
		.bind(window.asOf, window.monthEnd)
		.all<UpcomingPaymentRow>();

	return results.map(mapUpcomingPayment);
}

export async function getUpcomingIncome(
	db: DbClient,
	window: CashflowWindow
): Promise<UpcomingIncome[]> {
	const { results } = await db
		.prepare(
			`${plannedIncomeSelect()}
			WHERE i.status = 'planned'
				AND i.due_date BETWEEN ? AND ?
			ORDER BY i.due_date ASC, i.payer ASC`
		)
		.bind(window.asOf, window.monthEnd)
		.all<UpcomingIncomeRow>();

	return results.map(mapUpcomingIncome);
}

export async function getBalanceBeforeSalaryProjection(
	db: DbClient,
	window: CashflowWindow
): Promise<BalanceBeforeSalaryProjection> {
	const [nextIncome, currentBalanceCents] = await Promise.all([
		getNextPlannedIncome(db, window),
		getCurrentBalanceCents(db, window.asOf)
	]);
	const projectionDate = nextIncome ? previousDate(nextIncome.dueDate) : window.monthEnd;
	const upcomingPayments = await getPaymentsThroughDate(db, window.asOf, projectionDate);
	const upcomingPaymentCents = upcomingPayments.reduce(
		(sum, payment) => sum + payment.amountCents,
		0
	);

	return {
		asOf: window.asOf,
		projectionDate,
		nextIncome,
		currentBalanceCents,
		upcomingPaymentCents,
		projectedBalanceCents: currentBalanceCents - upcomingPaymentCents,
		upcomingPayments
	};
}

async function getNextPlannedIncome(
	db: DbClient,
	window: CashflowWindow
): Promise<UpcomingIncome | null> {
	const row = await db
		.prepare(
			`${plannedIncomeSelect()}
			WHERE i.status = 'planned'
				AND i.due_date BETWEEN ? AND ?
			ORDER BY i.due_date ASC, i.amount_cents DESC
			LIMIT 1`
		)
		.bind(window.asOf, window.monthEnd)
		.first<UpcomingIncomeRow>();

	return row ? mapUpcomingIncome(row) : null;
}

async function getPaymentsThroughDate(
	db: DbClient,
	from: string,
	to: string
): Promise<UpcomingPayment[]> {
	if (to < from) {
		return [];
	}

	const { results } = await db
		.prepare(
			`${plannedPaymentSelect()}
			WHERE p.status = 'planned'
				AND p.due_date BETWEEN ? AND ?
			ORDER BY p.due_date ASC, p.payee ASC`
		)
		.bind(from, to)
		.all<UpcomingPaymentRow>();

	return results.map(mapUpcomingPayment);
}

async function getCurrentBalanceCents(db: DbClient, asOf: string): Promise<number> {
	const row = await db
		.prepare(
			`SELECT COALESCE(SUM(balance_cents), 0) AS balance_cents
			FROM (
				SELECT
					a.current_balance_cents AS balance_cents
				FROM accounts a
				WHERE a.current_balance_cents IS NOT NULL
				UNION ALL
				SELECT
					a.opening_balance_cents + COALESCE(SUM(t.amount_cents), 0) AS balance_cents
				FROM accounts a
				LEFT JOIN transactions t ON t.account_id = a.id AND t.booking_date <= ?
				WHERE a.current_balance_cents IS NULL
				GROUP BY a.id, a.opening_balance_cents
			)`
		)
		.bind(asOf)
		.first<BalanceRow>();

	return row?.balance_cents ?? 0;
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

interface BalanceRow extends DbRow {
	balance_cents: number;
}
