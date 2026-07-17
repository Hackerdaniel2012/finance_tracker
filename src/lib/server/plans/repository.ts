import { ConflictError, NotFoundError, ValidationError } from '../accounts/errors';
import type { DbClient, DbRow, DbStatement } from '../db-client';
import { insertLiabilityBaseline } from '../liabilities/baselines';
import { rematchPlans } from './rematching';
import { assertPlanDates } from './validation';
import type { CreatePlanInput, Plan, PlanTransaction, UpdatePlanInput } from './types';

export async function listPlans(db: DbClient): Promise<Plan[]> {
	const { results } = await db
		.prepare(`${selectPlans()} ORDER BY p.status, p.next_date, p.counterparty`)
		.all<PlanRow>();
	return attachPlanTransactions(
		db,
		results.map((row) => mapPlan(row, []))
	);
}
export async function getPlan(db: DbClient, id: string): Promise<Plan | null> {
	const row = await db.prepare(`${selectPlans()} WHERE p.id = ?`).bind(id).first<PlanRow>();
	if (!row) return null;
	return (await attachPlanTransactions(db, [mapPlan(row, [])]))[0];
}
export async function createPlan(db: DbClient, input: CreatePlanInput): Promise<Plan> {
	assertPlanDates(input);
	const categoryId = input.liability ? 'cat-installment-plan' : input.categoryId;
	if (input.liability) {
		if (input.direction !== 'expense')
			throw new ValidationError('Liability plans must be expenses');
		if (input.cadence === 'once') throw new ValidationError('Liability plans must be recurring');
	}
	await assertLinks(db, input.accountId, categoryId, input.liabilityId);
	await assertLiabilityPlan(
		db,
		{
			accountId: input.accountId ?? null,
			categoryId: categoryId ?? null,
			direction: input.direction,
			cadence: input.cadence,
			liabilityId: input.liabilityId ?? null,
			status: input.status ?? 'active'
		},
		true
	);
	const id = crypto.randomUUID();
	const liabilityId = input.liability ? crypto.randomUUID() : (input.liabilityId ?? null);
	const statements: DbStatement[] = [];
	if (input.liability) {
		statements.push(
			db
				.prepare(
					`INSERT INTO marked_liabilities (id, account_id, name, amount_cents, as_of_date, annual_interest_rate_bps, status, note)
					VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`
				)
				.bind(
					liabilityId,
					input.accountId ?? null,
					input.liability.name,
					input.liability.amountCents,
					input.liability.asOfDate,
					input.liability.annualInterestRateBps,
					input.note ?? null
				)
		);
		statements.push(
			await insertLiabilityBaseline(
				db,
				liabilityId!,
				input.liability.amountCents,
				input.liability.asOfDate
			)
		);
	}
	statements.push(
		db
			.prepare(
				`INSERT INTO plans (id, account_id, category_id, label, counterparty, direction, cadence, amount_cents, next_date, end_date, status, source, source_recurring_group_id, liability_id, note, schedule_anchor_date, schedule_occurrence_index, manual_status)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', NULL, ?, ?, ?, 0, ?)`
			)
			.bind(
				id,
				input.accountId ?? null,
				categoryId ?? null,
				input.label ?? null,
				input.counterparty ?? null,
				input.direction,
				input.cadence,
				input.amountCents,
				input.nextDate,
				input.endDate ?? null,
				input.status ?? 'active',
				liabilityId,
				input.note ?? null,
				input.nextDate,
				input.status ?? 'active'
			)
	);
	await runBatch(db, statements);
	const plan = await getPlan(db, id);
	if (!plan) throw new NotFoundError('Created plan could not be loaded');
	return plan;
}

async function runBatch(db: DbClient, statements: DbStatement[]): Promise<void> {
	if (db.batch) {
		await db.batch(statements);
		return;
	}
	for (const statement of statements) await statement.run();
}
export async function updatePlan(db: DbClient, input: UpdatePlanInput): Promise<Plan> {
	const existing = await getPlan(db, input.id);
	if (!existing) throw new NotFoundError('Plan not found');
	const merged = {
		accountId: input.accountId === undefined ? existing.accountId : input.accountId,
		categoryId: input.categoryId === undefined ? existing.categoryId : input.categoryId,
		label: input.label === undefined ? existing.label : input.label,
		counterparty: input.counterparty === undefined ? existing.counterparty : input.counterparty,
		direction: input.direction ?? existing.direction,
		cadence: input.cadence ?? existing.cadence,
		amountCents: input.amountCents ?? existing.amountCents,
		nextDate: input.nextDate ?? existing.nextDate,
		endDate: input.endDate === undefined ? existing.endDate : input.endDate,
		status: input.status ?? existing.status,
		liabilityId: input.liabilityId === undefined ? existing.liabilityId : input.liabilityId,
		note: input.note === undefined ? existing.note : input.note
	};
	assertPlanDates(merged);
	await assertLinks(db, merged.accountId, merged.categoryId, merged.liabilityId);
	await assertLiabilityPlan(db, merged);
	const nextDateChanged = merged.nextDate !== existing.nextDate;
	const statusChanged = merged.status !== existing.status;
	const matchingChanged =
		merged.accountId !== existing.accountId ||
		merged.categoryId !== existing.categoryId ||
		merged.counterparty !== existing.counterparty ||
		merged.direction !== existing.direction ||
		merged.cadence !== existing.cadence ||
		merged.amountCents !== existing.amountCents ||
		nextDateChanged ||
		merged.endDate !== existing.endDate;
	const scheduleAnchorDate = nextDateChanged ? merged.nextDate : existing.scheduleAnchorDate;
	const scheduleOccurrenceIndex = matchingChanged ? 0 : existing.scheduleOccurrenceIndex;
	const manualStatus = statusChanged ? merged.status : existing.manualStatus;
	const statements: DbStatement[] = [];
	statements.push(
		db
			.prepare(
				`UPDATE plans SET account_id=?, category_id=?, label=?, counterparty=?, direction=?, cadence=?, amount_cents=?, next_date=?, end_date=?, status=?, liability_id=?, note=?, schedule_anchor_date=?, schedule_occurrence_index=?, manual_status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`
			)
			.bind(
				merged.accountId,
				merged.categoryId,
				merged.label,
				merged.counterparty,
				merged.direction,
				merged.cadence,
				merged.amountCents,
				matchingChanged ? scheduleAnchorDate : merged.nextDate,
				merged.endDate,
				merged.status,
				merged.liabilityId,
				merged.note,
				scheduleAnchorDate,
				scheduleOccurrenceIndex,
				manualStatus,
				input.id
			)
	);
	if (merged.liabilityId) {
		statements.push(
			db
				.prepare(
					'UPDATE marked_liabilities SET account_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
				)
				.bind(merged.accountId, merged.liabilityId)
		);
	}
	if (matchingChanged) {
		await rematchPlans(
			db,
			[input.id],
			statements,
			new Map([
				[
					input.id,
					{
						cadence: merged.cadence,
						nextDate: merged.nextDate,
						scheduleAnchorDate,
						manualStatus
					}
				]
			])
		);
	} else {
		await runBatch(db, statements);
	}
	const plan = await getPlan(db, input.id);
	if (!plan) throw new NotFoundError('Plan not found');
	return plan;
}
export async function deletePlan(db: DbClient, id: string): Promise<void> {
	const plan = await getPlan(db, id);
	if (!plan) throw new NotFoundError('Plan not found');
	if (plan.liabilityId)
		throw new ConflictError('Plans linked to liabilities must be deleted through the liability');
	await db.prepare('DELETE FROM plans WHERE id = ?').bind(id).run();
}
async function assertLinks(
	db: DbClient,
	accountId?: string | null,
	categoryId?: string | null,
	liabilityId?: string | null
): Promise<void> {
	if (
		accountId &&
		!(await db.prepare('SELECT id FROM accounts WHERE id = ?').bind(accountId).first())
	)
		throw new NotFoundError('Account not found');
	if (
		categoryId &&
		!(await db.prepare('SELECT id FROM categories WHERE id = ?').bind(categoryId).first())
	)
		throw new NotFoundError('Category not found');
	if (
		liabilityId &&
		!(await db.prepare('SELECT id FROM marked_liabilities WHERE id = ?').bind(liabilityId).first())
	)
		throw new NotFoundError('Liability not found');
}
function selectPlans(): string {
	return `SELECT p.*, a.name account_name, c.name category_name,
		(SELECT COUNT(*) FROM plan_transactions pt WHERE pt.plan_id = p.id) transaction_count,
		(SELECT MAX(t.booking_date) FROM plan_transactions pt JOIN transactions t ON t.id = pt.transaction_id WHERE pt.plan_id = p.id) last_transaction_date
		FROM plans p LEFT JOIN accounts a ON a.id=p.account_id LEFT JOIN categories c ON c.id=p.category_id`;
}
function mapPlan(row: PlanRow, transactions: PlanTransaction[]): Plan {
	return {
		id: row.id,
		accountId: row.account_id,
		accountName: row.account_name,
		categoryId: row.category_id,
		categoryName: row.category_name,
		label: row.label,
		counterparty: row.counterparty,
		direction: row.direction,
		cadence: row.cadence,
		amountCents: row.amount_cents,
		nextDate: row.next_date,
		endDate: row.end_date,
		status: row.status,
		source: row.source,
		sourceRecurringGroupId: row.source_recurring_group_id,
		liabilityId: row.liability_id,
		note: row.note,
		transactionCount: row.transaction_count,
		lastTransactionDate: row.last_transaction_date,
		transactions,
		scheduleAnchorDate: row.schedule_anchor_date ?? row.next_date,
		scheduleOccurrenceIndex: row.schedule_occurrence_index,
		manualStatus: row.manual_status ?? row.status,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

async function attachPlanTransactions(db: DbClient, plans: Plan[]): Promise<Plan[]> {
	if (plans.length === 0) return plans;
	const byPlan = new Map<string, PlanTransaction[]>();
	const ids = plans.map((plan) => plan.id);
	for (let offset = 0; offset < ids.length; offset += 100) {
		const chunk = ids.slice(offset, offset + 100);
		const { results } = await db
			.prepare(
				`SELECT pt.plan_id, pt.transaction_id, pt.match_kind, pt.scheduled_date,
					pt.interest_cents, pt.principal_cents, t.booking_date, t.amount_cents,
					t.payee, t.description, c.name AS category_name
				FROM plan_transactions pt
				JOIN transactions t ON t.id = pt.transaction_id
				LEFT JOIN categories c ON c.id = t.category_id
				WHERE pt.plan_id IN (${chunk.map(() => '?').join(', ')})
				ORDER BY t.booking_date DESC, t.id DESC`
			)
			.bind(...chunk)
			.all<PlanTransactionRow>();
		for (const row of results) {
			const transactions = byPlan.get(row.plan_id) ?? [];
			transactions.push({
				transactionId: row.transaction_id,
				bookingDate: row.booking_date,
				amountCents: row.amount_cents,
				payee: row.payee,
				description: row.description,
				categoryName: row.category_name,
				matchKind: row.match_kind,
				scheduledDate: row.scheduled_date,
				interestCents: row.interest_cents,
				principalCents: row.principal_cents
			});
			byPlan.set(row.plan_id, transactions);
		}
	}
	return plans.map((plan) => ({ ...plan, transactions: byPlan.get(plan.id) ?? [] }));
}
interface PlanRow extends DbRow {
	id: string;
	account_id: string | null;
	account_name: string | null;
	category_id: string | null;
	category_name: string | null;
	label: string | null;
	counterparty: string | null;
	direction: Plan['direction'];
	cadence: Plan['cadence'];
	amount_cents: number;
	next_date: string;
	end_date: string | null;
	status: Plan['status'];
	source: Plan['source'];
	source_recurring_group_id: string | null;
	liability_id: string | null;
	note: string | null;
	transaction_count: number;
	last_transaction_date: string | null;
	schedule_anchor_date: string | null;
	schedule_occurrence_index: number;
	manual_status: Plan['status'] | null;
	created_at: string;
	updated_at: string;
}

interface PlanTransactionRow extends DbRow {
	plan_id: string;
	transaction_id: string;
	match_kind: PlanTransaction['matchKind'];
	scheduled_date: string | null;
	interest_cents: number | null;
	principal_cents: number | null;
	booking_date: string;
	amount_cents: number;
	payee: string | null;
	description: string | null;
	category_name: string | null;
}

async function assertLiabilityPlan(
	db: DbClient,
	input: Pick<
		CreatePlanInput,
		'accountId' | 'categoryId' | 'direction' | 'cadence' | 'liabilityId' | 'status'
	>,
	requireAccountMatch = false
): Promise<void> {
	if (!input.liabilityId) return;
	if (input.direction !== 'expense') throw new ValidationError('Liability plans must be expenses');
	if (input.cadence === 'once') throw new ValidationError('Liability plans must be recurring');
	if (input.categoryId !== 'cat-installment-plan')
		throw new ValidationError('Liability plans must use the Installment plan category');
	const liability = await db
		.prepare('SELECT id, account_id, status FROM marked_liabilities WHERE id = ?')
		.bind(input.liabilityId)
		.first<LiabilityLinkRow>();
	if (!liability) throw new NotFoundError('Liability not found');
	if (liability.status === 'cleared' && input.status !== 'done')
		throw new ValidationError('Cleared liabilities require a done plan');
	if (requireAccountMatch && liability.account_id !== (input.accountId ?? null))
		throw new ValidationError('Liability plan account must match its liability account');
}

interface LiabilityLinkRow extends DbRow {
	id: string;
	account_id: string | null;
	status: 'active' | 'cleared';
}
