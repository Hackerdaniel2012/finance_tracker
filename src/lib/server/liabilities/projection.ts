import { occurrenceDate } from '$lib/plans/cadence';
import { calculatePeriodicInterest, calculatePrincipalPayment } from '../plans/matching';
import type { PlanCadence } from '../plans/types';
import type { LiabilityProjection } from './types';

const maximumProjectedPayments = 10_000;

export function projectLiability(input: {
	amountCents: number;
	annualInterestRateBps: number;
	paymentCents: number;
	cadence: PlanCadence;
	nextDate: string;
	scheduleAnchorDate?: string;
	scheduleOccurrenceIndex?: number;
}): LiabilityProjection {
	const nextPrincipalCents = Math.min(
		input.amountCents,
		calculatePrincipalPayment(
			input.amountCents,
			input.paymentCents,
			input.annualInterestRateBps,
			input.cadence
		)
	);
	const nextInterestCents = Math.min(
		input.paymentCents,
		calculatePeriodicInterest(input.amountCents, input.annualInterestRateBps, input.cadence)
	);
	if (input.amountCents === 0) {
		return {
			nextInterestCents: 0,
			nextPrincipalCents: 0,
			estimatedRemainingPayments: 0,
			estimatedPayoffDate: null,
			estimatedRemainingInterestCents: 0
		};
	}
	if (nextPrincipalCents <= 0 || input.cadence === 'once') {
		return {
			nextInterestCents,
			nextPrincipalCents,
			estimatedRemainingPayments:
				input.cadence === 'once' && nextPrincipalCents >= input.amountCents ? 1 : null,
			estimatedPayoffDate:
				input.cadence === 'once' && nextPrincipalCents >= input.amountCents ? input.nextDate : null,
			estimatedRemainingInterestCents:
				input.cadence === 'once' && nextPrincipalCents >= input.amountCents
					? nextInterestCents
					: null
		};
	}

	let balanceCents = input.amountCents;
	let estimatedRemainingInterestCents = 0;
	let estimatedRemainingPayments = 0;
	let estimatedPayoffDate = input.nextDate;
	while (balanceCents > 0 && estimatedRemainingPayments < maximumProjectedPayments) {
		const principalCents = Math.min(
			balanceCents,
			calculatePrincipalPayment(
				balanceCents,
				input.paymentCents,
				input.annualInterestRateBps,
				input.cadence
			)
		);
		if (principalCents <= 0) {
			return {
				nextInterestCents,
				nextPrincipalCents,
				estimatedRemainingPayments: null,
				estimatedPayoffDate: null,
				estimatedRemainingInterestCents: null
			};
		}
		const interestCents = calculatePeriodicInterest(
			balanceCents,
			input.annualInterestRateBps,
			input.cadence
		);
		estimatedRemainingInterestCents += Math.min(input.paymentCents, interestCents);
		balanceCents -= principalCents;
		estimatedRemainingPayments += 1;
		estimatedPayoffDate = projectedPaymentDate(
			input.scheduleAnchorDate ?? input.nextDate,
			input.cadence,
			(input.scheduleOccurrenceIndex ?? 0) + estimatedRemainingPayments - 1
		);
	}

	if (balanceCents > 0) {
		return {
			nextInterestCents,
			nextPrincipalCents,
			estimatedRemainingPayments: null,
			estimatedPayoffDate: null,
			estimatedRemainingInterestCents: null
		};
	}
	return {
		nextInterestCents,
		nextPrincipalCents,
		estimatedRemainingPayments,
		estimatedPayoffDate,
		estimatedRemainingInterestCents
	};
}

function projectedPaymentDate(
	firstDate: string,
	cadence: Exclude<PlanCadence, 'once'>,
	index: number
): string {
	if (index === 0) return firstDate;
	return occurrenceDate(firstDate, cadence, index);
}
