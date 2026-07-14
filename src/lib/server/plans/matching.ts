import { advanceDate, isOccurrenceWithinEndDate, occurrenceDate } from '$lib/plans/cadence';
import type { DbClient, DbRow, DbStatement } from '../db-client';
import type { Plan, PlanCadence, PlanStatus } from './types';

export function canonicalizeCounterparty(value: string | null): string {
	return (value ?? '')
		.toLocaleLowerCase('de-DE')
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

export function advancePlanDate(date: string, cadence: Exclude<PlanCadence, 'once'>): string {
	return advanceDate(date, cadence);
}

export async function reconcilePlans(db: DbClient): Promise<void> {
	const [{ results: planRows }, { results: transactionRows }] = await Promise.all([
		db
			.prepare(
				`SELECT p.*, l.amount_cents AS liability_amount_cents,
						l.as_of_date AS liability_as_of_date,
						l.status AS liability_status,
						l.annual_interest_rate_bps AS liability_interest_rate_bps,
						b.as_of_date AS liability_baseline_date
					FROM plans p
					LEFT JOIN marked_liabilities l ON l.id = p.liability_id
					LEFT JOIN liability_balance_baselines b ON b.liability_id = p.liability_id
				WHERE p.status = 'active'`
			)
			.all<PlanRow>(),
		db
			.prepare(
				`SELECT t.id, t.account_id, t.category_id, t.payee, t.booking_date, t.amount_cents
				FROM transactions t
				LEFT JOIN plan_transactions pt ON pt.transaction_id = t.id
				WHERE pt.transaction_id IS NULL
				ORDER BY t.booking_date, t.id`
			)
			.all<TransactionRow>()
	]);

	const plans = planRows.map(toMutablePlan);
	const remainingTransactions = new Map(
		transactionRows.map((transaction) => [transaction.id, transaction])
	);
	const events: MatchEvent[] = [];

	for (const plan of plans) completeIfPastEnd(plan);

	while (true) {
		const proposals = new Map<string, MatchProposal[]>();
		for (const plan of plans) {
			if (plan.status !== 'active') continue;
			const proposal = findNextProposal(plan, [...remainingTransactions.values()]);
			if (!proposal) continue;
			const transaction = proposal.transaction;
			const proposedPlans = proposals.get(transaction.id) ?? [];
			proposedPlans.push(proposal);
			proposals.set(transaction.id, proposedPlans);
		}

		const accepted = [...proposals.entries()].filter(([, candidates]) => candidates.length === 1);
		if (accepted.length === 0) break;

		for (const [transactionId, [proposal]] of accepted) {
			const transaction = remainingTransactions.get(transactionId);
			if (!transaction || proposal.plan.status !== 'active') continue;
			events.push(
				applyMatch(proposal.plan, transaction, proposal.scheduledDate, proposal.occurrenceIndex)
			);
			remainingTransactions.delete(transactionId);
		}
	}

	const statements: DbStatement[] = events.map((event) => insertMatchStatement(db, event));
	for (const plan of plans) {
		if (!plan.dirty) continue;
		statements.push(
			db
				.prepare(
					`UPDATE plans
					SET next_date = ?, schedule_occurrence_index = ?, status = ?, updated_at = CURRENT_TIMESTAMP
					WHERE id = ?`
				)
				.bind(plan.nextDate, plan.occurrenceIndex, plan.status, plan.id)
		);
		if (plan.liabilityId && plan.liabilityDirty) {
			statements.push(
				db
					.prepare(
						`UPDATE marked_liabilities
						SET amount_cents = ?, as_of_date = ?, status = ?, updated_at = CURRENT_TIMESTAMP
						WHERE id = ?`
					)
					.bind(
						plan.liabilityAmountCents!,
						plan.liabilityAsOfDate!,
						plan.liabilityStatus!,
						plan.liabilityId
					)
			);
		}
	}

	if (statements.length === 0) return;
	if (db.batch) await db.batch(statements);
	else for (const statement of statements) await statement.run();
}

function applyMatch(
	plan: MutablePlan,
	transaction: TransactionRow,
	scheduledDate: string,
	matchedOccurrenceIndex: number
): MatchEvent {
	const event: MatchEvent = {
		planId: plan.id,
		transactionId: transaction.id,
		scheduledDate,
		occurrenceIndex: matchedOccurrenceIndex,
		planNextDateBefore: plan.nextDate,
		planOccurrenceIndexBefore: plan.occurrenceIndex,
		planStatusBefore: plan.status,
		liabilityId: plan.liabilityId,
		liabilityAmountBefore: plan.liabilityAmountCents,
		liabilityAsOfDateBefore: plan.liabilityAsOfDate,
		liabilityStatusBefore: plan.liabilityStatus,
		interestCents: null,
		principalCents: null
	};

	if (plan.liabilityId && plan.liabilityAmountCents !== null) {
		const interest = calculatePeriodicInterest(
			plan.liabilityAmountCents,
			plan.liabilityInterestRateBps ?? 0,
			plan.cadence
		);
		const principal = Math.min(plan.liabilityAmountCents, Math.max(0, plan.amountCents - interest));
		plan.liabilityAmountCents -= principal;
		plan.liabilityAsOfDate = transaction.booking_date;
		plan.liabilityStatus = plan.liabilityAmountCents === 0 ? 'cleared' : 'active';
		plan.liabilityDirty = true;
		event.interestCents = Math.min(plan.amountCents, interest);
		event.principalCents = principal;
	}

	if (plan.cadence === 'once') {
		plan.status = 'done';
	} else {
		plan.occurrenceIndex = matchedOccurrenceIndex + 1;
		plan.nextDate = currentOccurrenceDate(plan);
		if (!isOccurrenceWithinEndDate(plan.nextDate, plan.endDate)) plan.status = 'done';
	}
	if (plan.liabilityAmountCents === 0) plan.status = 'done';
	plan.dirty = true;
	return event;
}

function insertMatchStatement(db: DbClient, event: MatchEvent): DbStatement {
	return db
		.prepare(
			`INSERT INTO plan_transactions (
				plan_id, transaction_id, match_kind, scheduled_date, occurrence_index,
				plan_next_date_before, plan_occurrence_index_before, plan_status_before, liability_id,
				liability_amount_before, liability_as_of_date_before, liability_status_before,
				interest_cents, principal_cents
			) VALUES (?, ?, 'automatic', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			event.planId,
			event.transactionId,
			event.scheduledDate,
			event.occurrenceIndex,
			event.planNextDateBefore,
			event.planOccurrenceIndexBefore,
			event.planStatusBefore,
			event.liabilityId,
			event.liabilityAmountBefore,
			event.liabilityAsOfDateBefore,
			event.liabilityStatusBefore,
			event.interestCents,
			event.principalCents
		);
}

function findNextProposal(plan: MutablePlan, transactions: TransactionRow[]): MatchProposal | null {
	if (transactions.length === 0) return null;
	const latestDate = transactions.reduce(
		(latest, transaction) =>
			transaction.booking_date > latest ? transaction.booking_date : latest,
		transactions[0].booking_date
	);
	let occurrenceIndex = plan.occurrenceIndex;
	for (let checked = 0; checked < 10_000; checked += 1) {
		const scheduledDate = occurrenceDate(plan.scheduleAnchorDate, plan.cadence, occurrenceIndex);
		if (!isOccurrenceWithinEndDate(scheduledDate, plan.endDate)) {
			plan.status = 'done';
			plan.dirty = true;
			return null;
		}
		if (scheduledDate > addDays(latestDate, 3)) return null;
		const candidates = transactions.filter((transaction) =>
			matchesOccurrence(plan, transaction, scheduledDate)
		);
		if (candidates.length > 1) return null;
		if (candidates.length === 1)
			return { plan, transaction: candidates[0], scheduledDate, occurrenceIndex };
		if (plan.cadence === 'once') return null;
		occurrenceIndex += 1;
	}
	return null;
}

function matchesOccurrence(
	plan: MutablePlan,
	transaction: TransactionRow,
	scheduledDate: string
): boolean {
	if ((plan.direction === 'expense') !== transaction.amount_cents < 0) return false;
	if (plan.liabilityBaselineDate && transaction.booking_date <= plan.liabilityBaselineDate)
		return false;
	if (Math.abs(transaction.amount_cents) !== plan.amountCents) return false;
	const allowedDrift = plan.cadence === 'daily' ? 0 : 3;
	if (Math.abs(daysBetween(scheduledDate, transaction.booking_date)) > allowedDrift) return false;
	if (plan.accountId && plan.accountId !== transaction.account_id) return false;
	if (plan.categoryId && plan.categoryId !== transaction.category_id) return false;
	return (
		!plan.counterparty ||
		canonicalizeCounterparty(plan.counterparty) === canonicalizeCounterparty(transaction.payee)
	);
}

function currentOccurrenceDate(plan: MutablePlan): string {
	return occurrenceDate(plan.scheduleAnchorDate, plan.cadence, plan.occurrenceIndex);
}

function completeIfPastEnd(plan: MutablePlan): void {
	if (!isOccurrenceWithinEndDate(currentOccurrenceDate(plan), plan.endDate)) {
		plan.status = 'done';
		plan.dirty = true;
	}
}

function toMutablePlan(row: PlanRow): MutablePlan {
	return {
		id: row.id,
		accountId: row.account_id,
		categoryId: row.category_id,
		counterparty: row.counterparty,
		direction: row.direction,
		cadence: row.cadence,
		amountCents: row.amount_cents,
		nextDate: row.next_date,
		endDate: row.end_date,
		status: row.status,
		scheduleAnchorDate: row.schedule_anchor_date ?? row.next_date,
		occurrenceIndex: row.schedule_occurrence_index,
		liabilityId: row.liability_id,
		liabilityAmountCents: row.liability_amount_cents,
		liabilityAsOfDate: row.liability_as_of_date,
		liabilityStatus: row.liability_status,
		liabilityInterestRateBps: row.liability_interest_rate_bps,
		liabilityBaselineDate: row.liability_baseline_date,
		dirty: false,
		liabilityDirty: false
	};
}

function daysBetween(a: string, b: string): number {
	return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

function addDays(value: string, days: number): string {
	const date = new Date(`${value}T00:00:00Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return date.toISOString().slice(0, 10);
}

export function calculatePrincipalPayment(
	outstandingCents: number,
	paymentCents: number,
	annualInterestRateBps: number,
	cadence: PlanCadence
): number {
	const interest = calculatePeriodicInterest(outstandingCents, annualInterestRateBps, cadence);
	return Math.max(0, paymentCents - interest);
}

export function calculatePeriodicInterest(
	outstandingCents: number,
	annualInterestRateBps: number,
	cadence: PlanCadence
): number {
	const periods =
		cadence === 'daily'
			? 365
			: cadence === 'weekly'
				? 52
				: cadence === 'biweekly'
					? 26
					: cadence === 'monthly'
						? 12
						: cadence === 'quarterly'
							? 4
							: 1;
	return Math.round((outstandingCents * (annualInterestRateBps / 10_000)) / periods);
}

interface MutablePlan {
	id: string;
	accountId: string | null;
	categoryId: string | null;
	counterparty: string | null;
	direction: Plan['direction'];
	cadence: Plan['cadence'];
	amountCents: number;
	nextDate: string;
	endDate: string | null;
	status: PlanStatus;
	scheduleAnchorDate: string;
	occurrenceIndex: number;
	liabilityId: string | null;
	liabilityAmountCents: number | null;
	liabilityAsOfDate: string | null;
	liabilityStatus: 'active' | 'cleared' | null;
	liabilityInterestRateBps: number | null;
	liabilityBaselineDate: string | null;
	dirty: boolean;
	liabilityDirty: boolean;
}

interface MatchEvent {
	planId: string;
	transactionId: string;
	scheduledDate: string;
	occurrenceIndex: number;
	planNextDateBefore: string;
	planOccurrenceIndexBefore: number;
	planStatusBefore: PlanStatus;
	liabilityId: string | null;
	liabilityAmountBefore: number | null;
	liabilityAsOfDateBefore: string | null;
	liabilityStatusBefore: 'active' | 'cleared' | null;
	interestCents: number | null;
	principalCents: number | null;
}

interface MatchProposal {
	plan: MutablePlan;
	transaction: TransactionRow;
	scheduledDate: string;
	occurrenceIndex: number;
}

interface PlanRow extends DbRow {
	id: string;
	account_id: string | null;
	category_id: string | null;
	counterparty: string | null;
	direction: Plan['direction'];
	cadence: Plan['cadence'];
	amount_cents: number;
	next_date: string;
	end_date: string | null;
	status: PlanStatus;
	schedule_anchor_date: string | null;
	schedule_occurrence_index: number;
	liability_id: string | null;
	liability_amount_cents: number | null;
	liability_as_of_date: string | null;
	liability_status: 'active' | 'cleared' | null;
	liability_interest_rate_bps: number | null;
	liability_baseline_date: string | null;
}

interface TransactionRow extends DbRow {
	id: string;
	account_id: string;
	category_id: string | null;
	payee: string | null;
	booking_date: string;
	amount_cents: number;
}
