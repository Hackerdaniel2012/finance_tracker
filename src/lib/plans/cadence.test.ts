import { describe, expect, it } from 'vitest';
import { occurrenceDate } from './cadence';

describe('plan cadence', () => {
	it('keeps a month-end anchor across short and long months', () => {
		expect(occurrenceDate('2026-01-31', 'monthly', 1)).toBe('2026-02-28');
		expect(occurrenceDate('2026-01-31', 'monthly', 2)).toBe('2026-03-31');
	});

	it('clamps leap-day yearly occurrences', () => {
		expect(occurrenceDate('2024-02-29', 'yearly', 1)).toBe('2025-02-28');
		expect(occurrenceDate('2024-02-29', 'yearly', 4)).toBe('2028-02-29');
	});

	it('advances daily and weekly occurrences by their exact interval', () => {
		expect(occurrenceDate('2026-07-01', 'daily', 6)).toBe('2026-07-07');
		expect(occurrenceDate('2026-07-01', 'weekly', 2)).toBe('2026-07-15');
	});
});
