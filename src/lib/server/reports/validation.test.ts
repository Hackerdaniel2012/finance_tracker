import { describe, expect, it } from 'vitest';
import { parseReportDateRange } from './validation';

describe('parseReportDateRange', () => {
	it('defaults to the last 12 months', () => {
		const range = parseReportDateRange(
			new URL('http://localhost/api/summary'),
			new Date('2026-07-09T12:00:00.000Z')
		);

		expect(range).toEqual({ from: '2025-08-01', to: '2026-07-09' });
	});
});
