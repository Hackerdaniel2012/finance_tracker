import type { CategoryCostProjectionReport } from '$lib/cashflow';
import { ValidationError } from '../accounts/errors';
import type { DbClient, DbRow } from '../db-client';
import { getUpcomingPayments } from './repository';
import type { CategoryCostProjectionOptions } from './types';

const historyMonthCount = 3;
const unknownCategoryId = 'cat-unknown';

export async function getCategoryCostProjection(
	db: DbClient,
	options: CategoryCostProjectionOptions
): Promise<CategoryCostProjectionReport> {
	const range = projectionRange(options.asOf, options.monthEnd);
	const totals = emptyAmounts();
	if (options.categoryIds.length === 0) return { range, categories: [], totals };

	const categories = await loadProjectionCategories(db, options.categoryIds);
	const actualAndHistory = await loadActualAndHistory(db, options, range);
	const payments = await getUpcomingPayments(db, options);
	const plannedByCategory = new Map<string, number>();
	const selected = new Set(options.categoryIds);

	for (const payment of payments) {
		const categoryId = payment.categoryId ?? unknownCategoryId;
		if (!selected.has(categoryId)) continue;
		plannedByCategory.set(
			categoryId,
			(plannedByCategory.get(categoryId) ?? 0) + payment.amountCents
		);
	}

	const items = categories.map((category) => {
		const amounts = actualAndHistory.get(category.id) ?? { actualCents: 0, historyCents: 0 };
		const historicalAverageCents = Math.round(amounts.historyCents / historyMonthCount);
		const plannedRemainingCents = plannedByCategory.get(category.id) ?? 0;
		const committedCents = amounts.actualCents + plannedRemainingCents;
		const projectedCents = Math.max(historicalAverageCents, committedCents);
		const item = {
			categoryId: category.id,
			categoryName: category.name,
			categoryColor: category.color,
			actualCents: amounts.actualCents,
			historicalAverageCents,
			plannedRemainingCents,
			committedCents,
			projectedCents,
			projectedRemainingCents: projectedCents - amounts.actualCents
		};

		addAmounts(totals, item);
		return item;
	});

	return { range, categories: items, totals };
}

async function loadProjectionCategories(
	db: DbClient,
	categoryIds: string[]
): Promise<ProjectionCategory[]> {
	const placeholders = categoryIds.map(() => '?').join(', ');
	const { results } = await db
		.prepare(
			`SELECT id, name, type, color, sort_order
			FROM categories
			WHERE id IN (${placeholders})
			ORDER BY sort_order, name, id`
		)
		.bind(...categoryIds)
		.all<ProjectionCategoryRow>();

	if (
		results.length !== categoryIds.length ||
		results.some((category) => category.type !== 'expense' && category.type !== 'unknown')
	) {
		throw new ValidationError('categoryId must reference expense or unknown categories');
	}

	return results.map((category) => ({
		id: category.id,
		name: category.name,
		color: category.color
	}));
}

async function loadActualAndHistory(
	db: DbClient,
	options: CategoryCostProjectionOptions,
	range: CategoryCostProjectionReport['range']
): Promise<Map<string, CategoryAmounts>> {
	const placeholders = options.categoryIds.map(() => '?').join(', ');
	const accountClause = options.accountId ? 'AND t.account_id = ?' : '';
	const normalizedCategory = `CASE
		WHEN t.category_id IS NULL THEN '${unknownCategoryId}'
		ELSE t.category_id
	END`;
	const { results } = await db
		.prepare(
			`SELECT ${normalizedCategory} AS category_id,
				COALESCE(SUM(CASE
					WHEN t.booking_date BETWEEN ? AND ? THEN -t.amount_cents
					ELSE 0
				END), 0) AS history_cents,
				COALESCE(SUM(CASE
					WHEN t.booking_date BETWEEN ? AND ? THEN -t.amount_cents
					ELSE 0
				END), 0) AS actual_cents
			FROM transactions t
			WHERE t.amount_cents < 0
				AND t.booking_date BETWEEN ? AND ?
				AND ${normalizedCategory} IN (${placeholders})
				${accountClause}
			GROUP BY ${normalizedCategory}`
		)
		.bind(
			range.historyFrom,
			range.historyTo,
			range.from,
			range.asOf,
			range.historyFrom,
			range.asOf,
			...options.categoryIds,
			...(options.accountId ? [options.accountId] : [])
		)
		.all<CategoryAmountRow>();

	return new Map(
		results.map((row) => [
			row.category_id,
			{ actualCents: row.actual_cents, historyCents: row.history_cents }
		])
	);
}

function projectionRange(asOf: string, monthEnd: string): CategoryCostProjectionReport['range'] {
	const from = `${asOf.slice(0, 7)}-01`;
	const historyMonths = Array.from({ length: historyMonthCount }, (_, index) =>
		shiftMonth(from, index - historyMonthCount)
	);
	return {
		from,
		asOf,
		to: monthEnd,
		historyFrom: `${historyMonths[0]}-01`,
		historyTo: previousDate(from),
		historyMonths
	};
}

function shiftMonth(isoMonthStart: string, offset: number): string {
	const [year, month] = isoMonthStart.split('-').map(Number);
	return new Date(Date.UTC(year, month - 1 + offset, 1)).toISOString().slice(0, 7);
}

function previousDate(date: string): string {
	const result = new Date(`${date}T00:00:00Z`);
	result.setUTCDate(result.getUTCDate() - 1);
	return result.toISOString().slice(0, 10);
}

function emptyAmounts() {
	return {
		actualCents: 0,
		historicalAverageCents: 0,
		plannedRemainingCents: 0,
		committedCents: 0,
		projectedCents: 0,
		projectedRemainingCents: 0
	};
}

function addAmounts(
	target: ReturnType<typeof emptyAmounts>,
	source: ReturnType<typeof emptyAmounts>
) {
	target.actualCents += source.actualCents;
	target.historicalAverageCents += source.historicalAverageCents;
	target.plannedRemainingCents += source.plannedRemainingCents;
	target.committedCents += source.committedCents;
	target.projectedCents += source.projectedCents;
	target.projectedRemainingCents += source.projectedRemainingCents;
}

interface ProjectionCategory {
	id: string;
	name: string;
	color: string | null;
}

interface ProjectionCategoryRow extends DbRow {
	id: string;
	name: string;
	type: string;
	color: string | null;
	sort_order: number;
}

interface CategoryAmountRow extends DbRow {
	category_id: string;
	history_cents: number;
	actual_cents: number;
}

interface CategoryAmounts {
	actualCents: number;
	historyCents: number;
}
