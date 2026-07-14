import { NotFoundError, ValidationError } from '../accounts/errors';
import type { DbClient, DbRow, DbStatement } from '../db-client';
import { insertLiabilityBaseline, rebuildLiabilityFromBaseline } from './baselines';
import { rematchPlans } from '../plans/rematching';
import type { PlanCadence, PlanStatus } from '../plans/types';
import { projectLiability } from './projection';
import type { CreateLiabilityInput, Liability, UpdateLiabilityInput } from './types';

export async function listLiabilities(db: DbClient): Promise<Liability[]> {
	const { results } = await db
		.prepare(
			`${selectLiabilities()}
			ORDER BY l.status ASC, l.as_of_date DESC, l.name ASC`
		)
		.all<LiabilityRow>();

	return results.map(mapLiability);
}

export async function createLiability(
	db: DbClient,
	input: CreateLiabilityInput
): Promise<Liability> {
	if (input.accountId) {
		await assertAccountExists(db, input.accountId);
	}

	const id = crypto.randomUUID();
	const insert = db
		.prepare(
			`INSERT INTO marked_liabilities (
				id, account_id, name, amount_cents, as_of_date, annual_interest_rate_bps,
				status, note
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(
			id,
			input.accountId ?? null,
			input.name,
			input.amountCents,
			input.asOfDate,
			input.annualInterestRateBps ?? null,
			input.status ?? 'active',
			input.note ?? null
		);
	const baseline = await insertLiabilityBaseline(db, id, input.amountCents, input.asOfDate);
	if (db.batch) await db.batch([insert, baseline]);
	else {
		await insert.run();
		await baseline.run();
	}

	const liability = await getLiability(db, id);
	if (!liability) {
		throw new NotFoundError('Created liability could not be loaded');
	}

	return liability;
}

export async function updateLiability(
	db: DbClient,
	input: UpdateLiabilityInput
): Promise<Liability> {
	const existing = await getLiability(db, input.id);
	if (!existing) {
		throw new NotFoundError('Liability not found');
	}
	if ((input.amountCents === undefined) !== (input.asOfDate === undefined))
		throw new ValidationError('amountCents and asOfDate must be updated together');
	if (existing.plan && input.annualInterestRateBps === null)
		throw new ValidationError('Liabilities linked to plans require an interest rate');

	if (input.accountId) {
		await assertAccountExists(db, input.accountId);
	}
	const baseline = await db
		.prepare(
			'SELECT amount_cents, as_of_date FROM liability_balance_baselines WHERE liability_id = ?'
		)
		.bind(input.id)
		.first<LiabilityBaselineRow>();
	const requestedBaselineAmount =
		input.amountCents ?? baseline?.amount_cents ?? existing.amountCents;
	const requestedBaselineDate = input.asOfDate ?? baseline?.as_of_date ?? existing.asOfDate;
	const amountChanged =
		input.amountCents !== undefined &&
		requestedBaselineAmount !== (baseline?.amount_cents ?? existing.amountCents);
	const asOfDateChanged =
		input.asOfDate !== undefined &&
		requestedBaselineDate !== (baseline?.as_of_date ?? existing.asOfDate);
	const baselineChanged = amountChanged || asOfDateChanged;

	const merged = {
		accountId: input.accountId === undefined ? existing.accountId : input.accountId,
		name: input.name ?? existing.name,
		amountCents: baselineChanged ? requestedBaselineAmount : existing.amountCents,
		asOfDate: baselineChanged ? requestedBaselineDate : existing.asOfDate,
		annualInterestRateBps:
			input.annualInterestRateBps === undefined
				? existing.annualInterestRateBps
				: input.annualInterestRateBps,
		status: input.status ?? existing.status,
		note: input.note === undefined ? existing.note : input.note
	};
	const accountChanged = merged.accountId !== existing.accountId;
	const interestRateChanged = merged.annualInterestRateBps !== existing.annualInterestRateBps;
	const statusChanged = merged.status !== existing.status;

	if (statusChanged && merged.status === 'active' && merged.amountCents === 0) {
		throw new ValidationError('A liability with no remaining balance cannot be reactivated');
	}

	const statements: DbStatement[] = [];
	if (baselineChanged) {
		statements.push(
			await insertLiabilityBaseline(db, input.id, requestedBaselineAmount, requestedBaselineDate)
		);
	}
	statements.push(
		db
			.prepare(
				`UPDATE marked_liabilities
			SET
				account_id = ?,
				name = ?,
				amount_cents = ?,
				as_of_date = ?,
				annual_interest_rate_bps = ?,
				status = ?,
				note = ?,
				updated_at = CURRENT_TIMESTAMP
			WHERE id = ?`
			)
			.bind(
				merged.accountId,
				merged.name,
				merged.amountCents,
				merged.asOfDate,
				merged.annualInterestRateBps,
				merged.status,
				merged.note,
				input.id
			)
	);
	if (existing.plan && accountChanged) {
		statements.push(
			db
				.prepare('UPDATE plans SET account_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
				.bind(merged.accountId, existing.plan.id)
		);
	}
	const requiresRematch = existing.plan && (accountChanged || asOfDateChanged);
	if (requiresRematch && existing.plan) {
		await rematchPlans(
			db,
			[existing.plan.id],
			statements,
			new Map([
				[
					existing.plan.id,
					{
						liability: {
							baselineAmount: requestedBaselineAmount,
							baselineDate: requestedBaselineDate,
							currentAmount: merged.amountCents,
							currentDate: merged.asOfDate,
							currentStatus: merged.status
						}
					}
				]
			])
		);
	} else {
		if (db.batch) await db.batch(statements);
		else for (const statement of statements) await statement.run();
	}

	if (!requiresRematch && (amountChanged || interestRateChanged)) {
		const preserveManualClear = !statusChanged && existing.status === 'cleared';
		await rebuildLiabilityFromBaseline(db, input.id, {
			statusOverride: merged.status === 'cleared' || preserveManualClear ? 'cleared' : undefined
		});
		const rebuilt = await getLiability(db, input.id);
		if (existing.plan && rebuilt?.status === 'cleared') {
			await db
				.prepare("UPDATE plans SET status = 'done', updated_at = CURRENT_TIMESTAMP WHERE id = ?")
				.bind(existing.plan.id)
				.run();
		}
	}

	if (statusChanged) {
		const current = await getLiability(db, input.id);
		const finalLiabilityStatus = current?.amountCents === 0 ? 'cleared' : merged.status;
		const finalStatus = finalLiabilityStatus === 'cleared' ? 'done' : null;
		const lifecycleStatements: DbStatement[] = [
			db
				.prepare(
					'UPDATE marked_liabilities SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
				)
				.bind(finalLiabilityStatus, input.id)
		];
		if (existing.plan) {
			lifecycleStatements.push(
				db
					.prepare(
						`UPDATE plans SET status = CASE WHEN ? IS NULL THEN manual_status ELSE ? END,
						updated_at = CURRENT_TIMESTAMP WHERE id = ?`
					)
					.bind(finalStatus, finalStatus, existing.plan.id)
			);
		}
		if (db.batch) await db.batch(lifecycleStatements);
		else for (const statement of lifecycleStatements) await statement.run();
	}

	const liability = await getLiability(db, input.id);
	if (!liability) {
		throw new NotFoundError('Liability not found');
	}

	return liability;
}

export async function deleteLiability(db: DbClient, id: string): Promise<void> {
	const liability = await getLiability(db, id);
	if (!liability) {
		throw new NotFoundError('Liability not found');
	}

	const statements = [
		db.prepare('DELETE FROM plans WHERE liability_id = ?').bind(id),
		db.prepare('DELETE FROM marked_liabilities WHERE id = ?').bind(id)
	];
	if (db.batch) await db.batch(statements);
	else for (const statement of statements) await statement.run();
}

async function getLiability(db: DbClient, id: string): Promise<Liability | null> {
	const row = await db
		.prepare(
			`${selectLiabilities()}
			WHERE l.id = ?`
		)
		.bind(id)
		.first<LiabilityRow>();

	return row ? mapLiability(row) : null;
}

async function assertAccountExists(db: DbClient, accountId: string): Promise<void> {
	const row = await db
		.prepare('SELECT id FROM accounts WHERE id = ?')
		.bind(accountId)
		.first<IdRow>();

	if (!row) {
		throw new NotFoundError('Account not found');
	}
}

function mapLiability(row: LiabilityRow): Liability {
	const plan = row.plan_id
		? {
				id: row.plan_id,
				label: row.plan_label,
				counterparty: row.plan_counterparty,
				categoryName: row.plan_category_name,
				cadence: row.plan_cadence!,
				amountCents: row.plan_amount_cents!,
				nextDate: row.plan_next_date!,
				endDate: row.plan_end_date,
				status: row.plan_status!
			}
		: null;
	return {
		id: row.id,
		accountId: row.account_id,
		accountName: row.account_name,
		name: row.name,
		amountCents: row.amount_cents,
		asOfDate: row.as_of_date,
		annualInterestRateBps: row.annual_interest_rate_bps,
		status: row.status,
		note: row.note,
		plan,
		projection:
			plan && row.annual_interest_rate_bps !== null
				? projectLiability({
						amountCents: row.amount_cents,
						annualInterestRateBps: row.annual_interest_rate_bps,
						paymentCents: plan.amountCents,
						cadence: plan.cadence,
						nextDate: plan.nextDate,
						scheduleAnchorDate: row.plan_schedule_anchor_date ?? plan.nextDate,
						scheduleOccurrenceIndex: row.plan_schedule_occurrence_index ?? 0
					})
				: null,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

function selectLiabilities(): string {
	return `SELECT
		l.id,
		l.account_id,
		a.name AS account_name,
		l.name,
		l.amount_cents,
		l.as_of_date,
		l.annual_interest_rate_bps,
		l.status,
		l.note,
		l.created_at,
		l.updated_at,
		p.id AS plan_id,
		p.label AS plan_label,
		p.counterparty AS plan_counterparty,
		c.name AS plan_category_name,
		p.cadence AS plan_cadence,
		p.amount_cents AS plan_amount_cents,
		p.next_date AS plan_next_date,
		p.end_date AS plan_end_date,
		p.status AS plan_status,
		p.schedule_anchor_date AS plan_schedule_anchor_date,
		p.schedule_occurrence_index AS plan_schedule_occurrence_index
	FROM marked_liabilities l
	LEFT JOIN accounts a ON a.id = l.account_id
	LEFT JOIN plans p ON p.id = (
		SELECT linked.id
		FROM plans linked
		WHERE linked.liability_id = l.id
		ORDER BY
			CASE linked.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
			linked.updated_at DESC
		LIMIT 1
	)
	LEFT JOIN categories c ON c.id = p.category_id`;
}

interface LiabilityRow extends DbRow {
	id: string;
	account_id: string | null;
	account_name: string | null;
	name: string;
	amount_cents: number;
	as_of_date: string;
	annual_interest_rate_bps: number | null;
	status: 'active' | 'cleared';
	note: string | null;
	created_at: string;
	updated_at: string;
	plan_id: string | null;
	plan_label: string | null;
	plan_counterparty: string | null;
	plan_category_name: string | null;
	plan_cadence: PlanCadence | null;
	plan_amount_cents: number | null;
	plan_next_date: string | null;
	plan_end_date: string | null;
	plan_status: PlanStatus | null;
	plan_schedule_anchor_date: string | null;
	plan_schedule_occurrence_index: number | null;
}

interface IdRow extends DbRow {
	id: string;
}

interface LiabilityBaselineRow extends DbRow {
	amount_cents: number;
	as_of_date: string;
}
