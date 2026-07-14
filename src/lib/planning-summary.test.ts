import { describe, expect, it } from 'vitest';
import { summarizePlans, type PlanSummaryInput } from './planning-summary';

const defaults: PlanSummaryInput = {
	direction: 'expense',
	cadence: 'monthly',
	amountCents: 1000,
	nextDate: '2026-07-20',
	endDate: null,
	status: 'active'
};

describe('expense plan summary', () => {
	it('counts remaining occurrences and normalizes recurring costs per month', () => {
		const summary = summarizePlans(
			[
				defaults,
				{ ...defaults, cadence: 'weekly', amountCents: 700, nextDate: '2026-07-14' },
				{ ...defaults, cadence: 'yearly', amountCents: 12000, nextDate: '2026-07-25' },
				{ ...defaults, cadence: 'once', amountCents: 5000, nextDate: '2026-07-30' }
			],
			'expense',
			'2026-07-13'
		);

		expect(summary.remainingThisMonthCents).toBe(20_100);
		expect(summary.activeRecurringCount).toBe(3);
		expect(summary.monthlyRecurringCents).toBe(5044);
	});

	it('excludes paused, ended, income, and already elapsed one-off plans', () => {
		const summary = summarizePlans(
			[
				{ ...defaults, status: 'paused' },
				{ ...defaults, direction: 'income' },
				{ ...defaults, endDate: '2026-07-12' },
				{ ...defaults, cadence: 'once', nextDate: '2026-07-12' }
			],
			'expense',
			'2026-07-13'
		);

		expect(summary).toEqual({
			remainingThisMonthCents: 0,
			activeRecurringCount: 0,
			monthlyRecurringCents: 0
		});
	});

	it('summarizes active recurring income independently from expenses', () => {
		const summary = summarizePlans(
			[
				defaults,
				{ ...defaults, direction: 'income', amountCents: 250_000 },
				{
					...defaults,
					direction: 'income',
					cadence: 'yearly',
					amountCents: 120_000
				}
			],
			'income',
			'2026-07-13'
		);

		expect(summary.activeRecurringCount).toBe(2);
		expect(summary.monthlyRecurringCents).toBe(260_000);
	});

	it('counts a clamped current occurrence from the original schedule anchor', () => {
		const summary = summarizePlans(
			[
				{
					...defaults,
					nextDate: '2026-02-28',
					scheduleAnchorDate: '2026-01-31',
					scheduleOccurrenceIndex: 1
				}
			],
			'expense',
			'2026-02-01'
		);
		expect(summary.remainingThisMonthCents).toBe(1000);
	});
});
