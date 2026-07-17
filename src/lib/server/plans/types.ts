export type PlanDirection = 'expense' | 'income';
export type PlanCadence =
	'once' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';
export type PlanStatus = 'active' | 'paused' | 'done' | 'cancelled';
export type PlanSource = 'manual' | 'migrated' | 'recurring_suggestion';
export type PlanTransactionMatchKind = 'evidence' | 'automatic';

export interface PlanTransaction {
	transactionId: string;
	bookingDate: string;
	amountCents: number;
	payee: string | null;
	description: string | null;
	categoryName: string | null;
	matchKind: PlanTransactionMatchKind;
	scheduledDate: string | null;
	interestCents: number | null;
	principalCents: number | null;
}

export interface Plan {
	id: string;
	accountId: string | null;
	accountName: string | null;
	categoryId: string | null;
	categoryName: string | null;
	label: string | null;
	counterparty: string | null;
	direction: PlanDirection;
	cadence: PlanCadence;
	amountCents: number;
	nextDate: string;
	endDate: string | null;
	status: PlanStatus;
	source: PlanSource;
	sourceRecurringGroupId: string | null;
	liabilityId: string | null;
	note: string | null;
	transactionCount: number;
	lastTransactionDate: string | null;
	transactions: PlanTransaction[];
	scheduleAnchorDate: string;
	scheduleOccurrenceIndex: number;
	manualStatus: PlanStatus;
	createdAt: string;
	updatedAt: string;
}

export interface CreatePlanInput {
	accountId?: string | null;
	categoryId?: string | null;
	label?: string | null;
	counterparty?: string | null;
	direction: PlanDirection;
	cadence: PlanCadence;
	amountCents: number;
	nextDate: string;
	endDate?: string | null;
	status?: PlanStatus;
	liabilityId?: string | null;
	liability?: {
		name: string;
		amountCents: number;
		asOfDate: string;
		annualInterestRateBps: number;
	};
	note?: string | null;
}

export interface UpdatePlanInput extends Partial<Omit<CreatePlanInput, 'liability'>> {
	id: string;
}
