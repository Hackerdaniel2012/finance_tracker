import { occurrenceDate } from '$lib/plans/cadence';
import type { DbClient, DbRow, DbStatement } from '../db-client';
import { reconcilePlans } from './matching';
import type { PlanCadence, PlanStatus } from './types';

export async function rematchPlans(
	db: DbClient,
	planIds: Iterable<string>,
	additionalStatements: DbStatement[] = [],
	overrides: ReadonlyMap<string, PlanRematchOverride> = new Map()
): Promise<void> {
	const ids = [...new Set(planIds)];
	const rows = await Promise.all(
		ids.map((id) =>
			db
				.prepare(
					`SELECT p.id, p.cadence, p.schedule_anchor_date, p.next_date, p.manual_status,
						p.liability_id, l.amount_cents AS liability_current_amount,
						l.as_of_date AS liability_current_date,
						l.status AS liability_current_status,
						b.amount_cents AS baseline_amount, b.as_of_date AS baseline_date
					FROM plans p
					LEFT JOIN marked_liabilities l ON l.id = p.liability_id
					LEFT JOIN liability_balance_baselines b ON b.liability_id = p.liability_id
					WHERE p.id = ?`
				)
				.bind(id)
				.first<RematchPlanRow>()
		)
	);

	const statements: DbStatement[] = [...additionalStatements];
	for (const row of rows) {
		if (!row) continue;
		const override = overrides.get(row.id);
		const cadence = override?.cadence ?? row.cadence;
		const anchor =
			override?.scheduleAnchorDate ??
			row.schedule_anchor_date ??
			override?.nextDate ??
			row.next_date;
		const baselineAmount = override?.liability?.baselineAmount ?? row.baseline_amount;
		const baselineDate = override?.liability?.baselineDate ?? row.baseline_date;
		const currentLiabilityAmount =
			override?.liability?.currentAmount ?? row.liability_current_amount;
		const currentLiabilityDate = override?.liability?.currentDate ?? row.liability_current_date;
		const currentLiabilityStatus =
			override?.liability?.currentStatus ?? row.liability_current_status;
		const hasBaseline = row.liability_id !== null && baselineDate !== null;
		const occurrenceIndex = hasBaseline
			? firstOccurrenceStrictlyAfter(anchor, cadence, baselineDate!)
			: 0;
		const nextDate = occurrenceDate(anchor, cadence, occurrenceIndex);
		const manuallyCleared =
			currentLiabilityStatus === 'cleared' && (currentLiabilityAmount ?? 0) > 0;
		const emptyBaseline = hasBaseline && baselineAmount === 0;
		const planStatus =
			manuallyCleared || emptyBaseline ? 'done' : (override?.manualStatus ?? row.manual_status);

		statements.push(
			db
				.prepare("DELETE FROM plan_transactions WHERE plan_id = ? AND match_kind = 'automatic'")
				.bind(row.id),
			db
				.prepare(
					`UPDATE plans SET next_date=?, schedule_occurrence_index=?, status=?,
						updated_at=CURRENT_TIMESTAMP WHERE id=?`
				)
				.bind(nextDate, occurrenceIndex, planStatus, row.id)
		);

		if (hasBaseline) {
			const restoredAmount = manuallyCleared ? currentLiabilityAmount! : baselineAmount!;
			const restoredDate = manuallyCleared ? currentLiabilityDate! : baselineDate!;
			statements.push(
				db
					.prepare(
						`UPDATE marked_liabilities SET amount_cents=?, as_of_date=?, status=?,
							updated_at=CURRENT_TIMESTAMP WHERE id=?`
					)
					.bind(
						restoredAmount,
						restoredDate,
						manuallyCleared || emptyBaseline ? 'cleared' : 'active',
						row.liability_id
					)
			);
		}
	}

	if (statements.length > 0) {
		if (db.batch) await db.batch(statements);
		else for (const statement of statements) await statement.run();
	}
	if (ids.length > 0) await reconcilePlans(db);
}

export interface PlanRematchOverride {
	cadence?: PlanCadence;
	nextDate?: string;
	scheduleAnchorDate?: string;
	manualStatus?: PlanStatus;
	liability?: {
		baselineAmount: number;
		baselineDate: string;
		currentAmount: number;
		currentDate: string;
		currentStatus: 'active' | 'cleared';
	};
}

export interface CategoryMutation {
	transactionId: string;
	categoryId: string | null;
}

export async function applyCategoryMutationsAndRematch(
	db: DbClient,
	mutations: Iterable<CategoryMutation>,
	statements: DbStatement[]
): Promise<void> {
	const targets = new Map<string, string | null>();
	for (const mutation of mutations) targets.set(mutation.transactionId, mutation.categoryId);
	const ids = [...targets.keys()];
	const affectedPlanIds = new Set<string>();
	for (let offset = 0; offset < ids.length; offset += 100) {
		const chunk = ids.slice(offset, offset + 100);
		const { results } = await db
			.prepare(
				`SELECT DISTINCT pt.plan_id, pt.transaction_id, p.category_id
				FROM plan_transactions pt
				JOIN plans p ON p.id = pt.plan_id
				WHERE pt.match_kind = 'automatic'
					AND pt.transaction_id IN (${chunk.map(() => '?').join(', ')})
					AND p.category_id IS NOT NULL`
			)
			.bind(...chunk)
			.all<CategoryLinkRow>();
		for (const row of results) {
			if (row.category_id !== targets.get(row.transaction_id)) affectedPlanIds.add(row.plan_id);
		}
	}
	if (affectedPlanIds.size > 0) {
		await rematchPlans(db, affectedPlanIds, statements);
		return;
	}
	if (statements.length > 0) {
		if (db.batch) await db.batch(statements);
		else for (const statement of statements) await statement.run();
	}
	if (ids.length > 0) await reconcilePlans(db);
}

function firstOccurrenceStrictlyAfter(
	anchor: string,
	cadence: PlanCadence,
	cutoff: string
): number {
	if (cadence === 'once') return 0;
	for (let index = 0; index < 10_000; index += 1) {
		if (occurrenceDate(anchor, cadence, index) > cutoff) return index;
	}
	throw new RangeError('Could not find a plan occurrence after the liability baseline');
}

interface CategoryLinkRow extends DbRow {
	plan_id: string;
	transaction_id: string;
	category_id: string;
}
interface RematchPlanRow extends DbRow {
	id: string;
	cadence: PlanCadence;
	schedule_anchor_date: string | null;
	next_date: string;
	manual_status: PlanStatus;
	liability_id: string | null;
	liability_current_amount: number | null;
	liability_current_date: string | null;
	liability_current_status: 'active' | 'cleared' | null;
	baseline_amount: number | null;
	baseline_date: string | null;
}
