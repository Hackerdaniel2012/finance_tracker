import { NotFoundError } from '../accounts/errors';
import type { DbClient, DbRow } from '../db-client';
import type {
	CreatePlannedIncomeInput,
	CreatePlannedPaymentInput,
	PlannedIncome,
	PlannedPayment,
	UpdatePlannedIncomeInput,
	UpdatePlannedPaymentInput
} from './types';

export async function listPlannedPayments(db: DbClient): Promise<PlannedPayment[]> {
	const { results } = await db
		.prepare(`${plannedPaymentSelect()} ORDER BY p.due_date ASC, p.payee ASC`)
		.all<PlannedPaymentRow>();

	return results.map(mapPlannedPayment);
}

export async function createPlannedPayment(
	db: DbClient,
	input: CreatePlannedPaymentInput
): Promise<PlannedPayment> {
	await assertOptionalLinks(db, input.accountId, input.categoryId);
	const id = crypto.randomUUID();

	await db
		.prepare(
			`INSERT INTO planned_payments (
				id, account_id, category_id, payee, amount_cents, due_date, status, note
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			id,
			input.accountId ?? null,
			input.categoryId ?? null,
			input.payee,
			input.amountCents,
			input.dueDate,
			input.status ?? 'planned',
			input.note ?? null
		)
		.run();

	const payment = await getPlannedPayment(db, id);
	if (!payment) throw new NotFoundError('Created planned payment could not be loaded');
	return payment;
}

export async function updatePlannedPayment(
	db: DbClient,
	input: UpdatePlannedPaymentInput
): Promise<PlannedPayment> {
	const existing = await getPlannedPayment(db, input.id);
	if (!existing) throw new NotFoundError('Planned payment not found');
	await assertOptionalLinks(db, input.accountId, input.categoryId);

	await db
		.prepare(
			`UPDATE planned_payments
			SET account_id = ?, category_id = ?, payee = ?, amount_cents = ?, due_date = ?,
				status = ?, note = ?, updated_at = CURRENT_TIMESTAMP
			WHERE id = ?`
		)
		.bind(
			input.accountId === undefined ? existing.accountId : input.accountId,
			input.categoryId === undefined ? existing.categoryId : input.categoryId,
			input.payee ?? existing.payee,
			input.amountCents ?? existing.amountCents,
			input.dueDate ?? existing.dueDate,
			input.status ?? existing.status,
			input.note === undefined ? existing.note : input.note,
			input.id
		)
		.run();

	const payment = await getPlannedPayment(db, input.id);
	if (!payment) throw new NotFoundError('Planned payment not found');
	return payment;
}

export async function deletePlannedPayment(db: DbClient, id: string): Promise<void> {
	if (!(await getPlannedPayment(db, id))) throw new NotFoundError('Planned payment not found');
	await db.prepare('DELETE FROM planned_payments WHERE id = ?').bind(id).run();
}

export async function listPlannedIncome(db: DbClient): Promise<PlannedIncome[]> {
	const { results } = await db
		.prepare(`${plannedIncomeSelect()} ORDER BY i.due_date ASC, i.payer ASC`)
		.all<PlannedIncomeRow>();

	return results.map(mapPlannedIncome);
}

export async function createPlannedIncome(
	db: DbClient,
	input: CreatePlannedIncomeInput
): Promise<PlannedIncome> {
	await assertOptionalLinks(db, input.accountId, input.categoryId);
	const id = crypto.randomUUID();

	await db
		.prepare(
			`INSERT INTO planned_income (
				id, account_id, category_id, payer, amount_cents, due_date, status, note
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			id,
			input.accountId ?? null,
			input.categoryId ?? null,
			input.payer,
			input.amountCents,
			input.dueDate,
			input.status ?? 'planned',
			input.note ?? null
		)
		.run();

	const income = await getPlannedIncome(db, id);
	if (!income) throw new NotFoundError('Created planned income could not be loaded');
	return income;
}

export async function updatePlannedIncome(
	db: DbClient,
	input: UpdatePlannedIncomeInput
): Promise<PlannedIncome> {
	const existing = await getPlannedIncome(db, input.id);
	if (!existing) throw new NotFoundError('Planned income not found');
	await assertOptionalLinks(db, input.accountId, input.categoryId);

	await db
		.prepare(
			`UPDATE planned_income
			SET account_id = ?, category_id = ?, payer = ?, amount_cents = ?, due_date = ?,
				status = ?, note = ?, updated_at = CURRENT_TIMESTAMP
			WHERE id = ?`
		)
		.bind(
			input.accountId === undefined ? existing.accountId : input.accountId,
			input.categoryId === undefined ? existing.categoryId : input.categoryId,
			input.payer ?? existing.payer,
			input.amountCents ?? existing.amountCents,
			input.dueDate ?? existing.dueDate,
			input.status ?? existing.status,
			input.note === undefined ? existing.note : input.note,
			input.id
		)
		.run();

	const income = await getPlannedIncome(db, input.id);
	if (!income) throw new NotFoundError('Planned income not found');
	return income;
}

export async function deletePlannedIncome(db: DbClient, id: string): Promise<void> {
	if (!(await getPlannedIncome(db, id))) throw new NotFoundError('Planned income not found');
	await db.prepare('DELETE FROM planned_income WHERE id = ?').bind(id).run();
}

async function getPlannedPayment(db: DbClient, id: string): Promise<PlannedPayment | null> {
	const row = await db
		.prepare(`${plannedPaymentSelect()} WHERE p.id = ?`)
		.bind(id)
		.first<PlannedPaymentRow>();

	return row ? mapPlannedPayment(row) : null;
}

async function getPlannedIncome(db: DbClient, id: string): Promise<PlannedIncome | null> {
	const row = await db
		.prepare(`${plannedIncomeSelect()} WHERE i.id = ?`)
		.bind(id)
		.first<PlannedIncomeRow>();

	return row ? mapPlannedIncome(row) : null;
}

function plannedPaymentSelect(): string {
	return `SELECT
		p.id, p.account_id, a.name AS account_name, p.category_id, c.name AS category_name,
		p.payee, p.amount_cents, p.due_date, p.status, p.note, p.created_at, p.updated_at
	FROM planned_payments p
	LEFT JOIN accounts a ON a.id = p.account_id
	LEFT JOIN categories c ON c.id = p.category_id`;
}

function plannedIncomeSelect(): string {
	return `SELECT
		i.id, i.account_id, a.name AS account_name, i.category_id, c.name AS category_name,
		i.payer, i.amount_cents, i.due_date, i.status, i.note, i.created_at, i.updated_at
	FROM planned_income i
	LEFT JOIN accounts a ON a.id = i.account_id
	LEFT JOIN categories c ON c.id = i.category_id`;
}

async function assertOptionalLinks(
	db: DbClient,
	accountId?: string | null,
	categoryId?: string | null
): Promise<void> {
	if (accountId) await assertExists(db, 'accounts', accountId, 'Account not found');
	if (categoryId) await assertExists(db, 'categories', categoryId, 'Category not found');
}

async function assertExists(
	db: DbClient,
	table: 'accounts' | 'categories',
	id: string,
	message: string
): Promise<void> {
	const row = await db.prepare(`SELECT id FROM ${table} WHERE id = ?`).bind(id).first<IdRow>();
	if (!row) throw new NotFoundError(message);
}

function mapPlannedPayment(row: PlannedPaymentRow): PlannedPayment {
	return {
		id: row.id,
		accountId: row.account_id,
		accountName: row.account_name,
		categoryId: row.category_id,
		categoryName: row.category_name,
		payee: row.payee,
		amountCents: row.amount_cents,
		dueDate: row.due_date,
		status: row.status,
		note: row.note,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

function mapPlannedIncome(row: PlannedIncomeRow): PlannedIncome {
	return {
		id: row.id,
		accountId: row.account_id,
		accountName: row.account_name,
		categoryId: row.category_id,
		categoryName: row.category_name,
		payer: row.payer,
		amountCents: row.amount_cents,
		dueDate: row.due_date,
		status: row.status,
		note: row.note,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

interface PlannedPaymentRow extends DbRow {
	id: string;
	account_id: string | null;
	account_name: string | null;
	category_id: string | null;
	category_name: string | null;
	payee: string;
	amount_cents: number;
	due_date: string;
	status: 'planned' | 'paid' | 'cancelled';
	note: string | null;
	created_at: string;
	updated_at: string;
}

interface PlannedIncomeRow extends DbRow {
	id: string;
	account_id: string | null;
	account_name: string | null;
	category_id: string | null;
	category_name: string | null;
	payer: string;
	amount_cents: number;
	due_date: string;
	status: 'planned' | 'received' | 'cancelled';
	note: string | null;
	created_at: string;
	updated_at: string;
}

interface IdRow extends DbRow {
	id: string;
}
