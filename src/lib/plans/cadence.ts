export type Cadence = 'once' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';

export function occurrenceDate(anchorDate: string, cadence: Cadence, index: number): string {
	if (!Number.isInteger(index) || index < 0)
		throw new RangeError('Occurrence index must be non-negative');
	if (cadence === 'once' && index !== 0)
		throw new RangeError('Once plans only have occurrence zero');

	const date = parseDate(anchorDate);
	if (cadence === 'daily') date.setUTCDate(date.getUTCDate() + index);
	else if (cadence === 'weekly') date.setUTCDate(date.getUTCDate() + index * 7);
	else if (cadence === 'biweekly') date.setUTCDate(date.getUTCDate() + index * 14);
	else if (cadence !== 'once') {
		const months = cadence === 'monthly' ? index : cadence === 'quarterly' ? index * 3 : index * 12;
		setUtcMonthClamped(date, months);
	}
	return formatDate(date);
}

export function advanceDate(date: string, cadence: Exclude<Cadence, 'once'>): string {
	return occurrenceDate(date, cadence, 1);
}

export function isOccurrenceWithinEndDate(date: string, endDate: string | null): boolean {
	return endDate === null || date <= endDate;
}

function setUtcMonthClamped(date: Date, months: number): void {
	const day = date.getUTCDate();
	date.setUTCDate(1);
	date.setUTCMonth(date.getUTCMonth() + months);
	const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
	date.setUTCDate(Math.min(day, lastDay));
}

function parseDate(value: string): Date {
	const date = new Date(`${value}T00:00:00.000Z`);
	if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value)
		throw new RangeError('Date must be a valid ISO date');
	return date;
}

function formatDate(date: Date): string {
	return date.toISOString().slice(0, 10);
}
