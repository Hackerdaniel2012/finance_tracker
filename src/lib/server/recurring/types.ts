export type RecurringCadence = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';
export type RecurringStatus = 'suggested' | 'confirmed' | 'ignored';
export type RecurringSource = 'manual' | 'imported' | 'confirmed_suggestion';
export type RecurringDirection = 'incoming' | 'outgoing';

export interface RecurringEvidence {
	transactionId: string;
	bookingDate: string;
	amountCents: number;
	payee: string | null;
	description: string | null;
}

export interface RecurringConfidenceFactors {
	interval: number;
	amount: number;
	history: number;
	recency: number;
}

export interface RecurringGroup {
	id: string;
	accountId: string | null;
	accountName: string | null;
	categoryId: string | null;
	categoryName: string | null;
	label: string | null;
	payee: string;
	direction: RecurringDirection | null;
	canonicalPayeeKey: string;
	cadence: RecurringCadence;
	expectedAmountCents: number;
	nextDate: string | null;
	endDate: string | null;
	status: RecurringStatus;
	confidence: number;
	confidenceFactors: RecurringConfidenceFactors;
	source: RecurringSource;
	needsReview: boolean;
	detectorVersion: number;
	transactionCount: number;
	evidence: RecurringEvidence[];
	createdAt: string;
	updatedAt: string;
}

export interface UpdateRecurringGroupInput {
	id: string;
	accountId?: string | null;
	categoryId?: string | null;
	label?: string | null;
	payee?: string;
	direction?: RecurringDirection;
	cadence?: RecurringCadence;
	expectedAmountCents?: number;
	nextDate?: string | null;
	endDate?: string | null;
	status?: Exclude<RecurringStatus, 'confirmed'>;
	confidence?: number;
	source?: RecurringSource;
}

export type ConfirmRecurringSuggestionInput = Omit<
	UpdateRecurringGroupInput,
	'status' | 'confidence' | 'source'
> & {
	liability?: {
		name: string;
		amountCents: number;
		asOfDate: string;
		annualInterestRateBps: number;
	};
};
