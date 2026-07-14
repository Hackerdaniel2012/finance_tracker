import type { PlanCadence, PlanStatus } from '../plans/types';

export type LiabilityStatus = 'active' | 'cleared';
export interface LiabilityPlanSummary {
	id: string;
	label: string | null;
	counterparty: string | null;
	categoryName: string | null;
	cadence: PlanCadence;
	amountCents: number;
	nextDate: string;
	endDate: string | null;
	status: PlanStatus;
}

export interface LiabilityProjection {
	nextInterestCents: number;
	nextPrincipalCents: number;
	estimatedRemainingPayments: number | null;
	estimatedPayoffDate: string | null;
	estimatedRemainingInterestCents: number | null;
}

export interface Liability {
	id: string;
	accountId: string | null;
	accountName: string | null;
	name: string;
	amountCents: number;
	asOfDate: string;
	annualInterestRateBps: number | null;
	status: LiabilityStatus;
	note: string | null;
	plan: LiabilityPlanSummary | null;
	projection: LiabilityProjection | null;
	createdAt: string;
	updatedAt: string;
}

export interface CreateLiabilityInput {
	accountId?: string | null;
	name: string;
	amountCents: number;
	asOfDate: string;
	annualInterestRateBps?: number | null;
	status?: LiabilityStatus;
	note?: string | null;
}

export interface UpdateLiabilityInput {
	id: string;
	accountId?: string | null;
	name?: string;
	amountCents?: number;
	asOfDate?: string;
	annualInterestRateBps?: number | null;
	status?: LiabilityStatus;
	note?: string | null;
}
