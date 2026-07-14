import { occurrenceDate } from '$lib/plans/cadence';

export type SummaryCadence =
	'once' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';

export interface PlanSummaryInput {
	direction: 'expense' | 'income';
	cadence: SummaryCadence;
	amountCents: number;
	nextDate: string;
	endDate: string | null;
	status: 'active' | 'paused' | 'done' | 'cancelled';
	scheduleAnchorDate?: string;
	scheduleOccurrenceIndex?: number;
}

export interface PlanSummary {
	remainingThisMonthCents: number;
	activeRecurringCount: number;
	monthlyRecurringCents: number;
}

const monthlyFactors: Record<Exclude<SummaryCadence, 'once'>, number> = {
	daily: 365.2425 / 12,
	weekly: 365.2425 / 7 / 12,
	biweekly: 365.2425 / 14 / 12,
	monthly: 1,
	quarterly: 1 / 3,
	yearly: 1 / 12
};

export function summarizePlans(
	plans: PlanSummaryInput[],
	direction: PlanSummaryInput['direction'],
	asOf: string
): PlanSummary {
	const monthEnd = endOfMonth(asOf);
	const activePlans = plans.filter(
		(plan) =>
			plan.direction === direction &&
			plan.status === 'active' &&
			(!plan.endDate || plan.endDate >= asOf)
	);
	const recurring = activePlans.filter(
		(plan) => plan.cadence !== 'once' && (!plan.endDate || currentOccurrence(plan) <= plan.endDate)
	);

	return {
		remainingThisMonthCents: activePlans.reduce(
			(total, plan) => total + occurrencesBetween(plan, asOf, monthEnd) * plan.amountCents,
			0
		),
		activeRecurringCount: recurring.length,
		monthlyRecurringCents: Math.round(
			recurring.reduce(
				(total, plan) =>
					total +
					plan.amountCents * monthlyFactors[plan.cadence as Exclude<SummaryCadence, 'once'>],
				0
			)
		)
	};
}

function occurrencesBetween(plan: PlanSummaryInput, from: string, to: string): number {
	if (plan.cadence === 'once') {
		return plan.nextDate >= from && plan.nextDate <= to ? 1 : 0;
	}
	let index = plan.scheduleOccurrenceIndex ?? 0;
	const anchor = plan.scheduleAnchorDate ?? plan.nextDate;
	let date = occurrenceDate(anchor, plan.cadence, index);
	while (date < from) {
		index += 1;
		date = occurrenceDate(anchor, plan.cadence, index);
	}
	let count = 0;
	while (date <= to && (!plan.endDate || date <= plan.endDate)) {
		count += 1;
		index += 1;
		date = occurrenceDate(anchor, plan.cadence, index);
	}
	return count;
}

function endOfMonth(value: string): string {
	const date = parseDate(value);
	return formatDate(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)));
}

function currentOccurrence(plan: PlanSummaryInput): string {
	return occurrenceDate(
		plan.scheduleAnchorDate ?? plan.nextDate,
		plan.cadence,
		plan.scheduleOccurrenceIndex ?? 0
	);
}

function parseDate(value: string): Date {
	return new Date(`${value}T00:00:00Z`);
}

function formatDate(date: Date): string {
	return date.toISOString().slice(0, 10);
}
