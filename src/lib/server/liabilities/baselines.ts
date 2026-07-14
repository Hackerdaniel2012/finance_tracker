import type { DbClient, DbRow, DbStatement } from '../db-client';
import { calculatePeriodicInterest } from '../plans/matching';
import type { PlanCadence } from '../plans/types';

export async function insertLiabilityBaseline(
	db: DbClient,
	liabilityId: string,
	amountCents: number,
	asOfDate: string
): Promise<DbStatement> {
	return db
		.prepare(
			`INSERT INTO liability_balance_baselines (liability_id, amount_cents, as_of_date)
			 VALUES (?, ?, ?)
			 ON CONFLICT(liability_id) DO UPDATE SET amount_cents=excluded.amount_cents,
			 as_of_date=excluded.as_of_date, updated_at=CURRENT_TIMESTAMP`
		)
		.bind(liabilityId, amountCents, asOfDate);
}

/** Restores a liability from its authoritative manual baseline plus retained automatic matches. */
export async function rebuildLiabilityFromBaseline(
	db: DbClient,
	liabilityId: string,
	options: { statusOverride?: 'active' | 'cleared' } = {}
): Promise<void> {
	const baseline = await db
		.prepare(
			'SELECT amount_cents, as_of_date FROM liability_balance_baselines WHERE liability_id = ?'
		)
		.bind(liabilityId)
		.first<BaselineRow>();
	const liability = await db
		.prepare('SELECT annual_interest_rate_bps FROM marked_liabilities WHERE id = ?')
		.bind(liabilityId)
		.first<LiabilityRow>();
	if (!baseline || !liability) return;
	const { results: matches } = await db
		.prepare(
			`SELECT pt.plan_id, pt.transaction_id, p.cadence, p.amount_cents, t.booking_date
			 FROM plan_transactions pt
			 JOIN plans p ON p.id = pt.plan_id
			 JOIN transactions t ON t.id = pt.transaction_id
			 WHERE pt.liability_id = ? AND pt.match_kind = 'automatic'
				AND t.booking_date > ?
			 ORDER BY t.booking_date, pt.occurrence_index, t.id`
		)
		.bind(liabilityId, baseline.as_of_date)
		.all<MatchRow>();
	let amount = baseline.amount_cents;
	let asOfDate = baseline.as_of_date;
	const statements: DbStatement[] = [
		db
			.prepare(
				`UPDATE plan_transactions
				SET interest_cents = NULL, principal_cents = NULL
				WHERE liability_id = ? AND match_kind = 'automatic'`
			)
			.bind(liabilityId)
	];
	for (const match of matches) {
		const interest = calculatePeriodicInterest(
			amount,
			liability.annual_interest_rate_bps ?? 0,
			match.cadence
		);
		const principal = Math.min(amount, Math.max(0, match.amount_cents - interest));
		amount -= principal;
		asOfDate = match.booking_date;
		statements.push(
			db
				.prepare(
					'UPDATE plan_transactions SET interest_cents=?, principal_cents=? WHERE plan_id=? AND transaction_id=?'
				)
				.bind(
					Math.min(match.amount_cents, interest),
					principal,
					match.plan_id,
					match.transaction_id
				)
		);
	}
	statements.push(
		db
			.prepare(
				'UPDATE marked_liabilities SET amount_cents=?, as_of_date=?, status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?'
			)
			.bind(
				amount,
				asOfDate,
				options.statusOverride ?? (amount === 0 ? 'cleared' : 'active'),
				liabilityId
			)
	);
	if (db.batch) await db.batch(statements);
	else for (const statement of statements) await statement.run();
}

interface BaselineRow extends DbRow {
	amount_cents: number;
	as_of_date: string;
}
interface LiabilityRow extends DbRow {
	annual_interest_rate_bps: number | null;
}
interface MatchRow extends DbRow {
	plan_id: string;
	transaction_id: string;
	cadence: PlanCadence;
	amount_cents: number;
	booking_date: string;
}
