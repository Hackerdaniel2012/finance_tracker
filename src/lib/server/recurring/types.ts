export type RecurringCadence = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';
export type RecurringStatus = 'suggested' | 'confirmed' | 'ignored';
export type RecurringSource = 'manual' | 'imported' | 'confirmed_suggestion';
export type RecurringDirection = 'incoming' | 'outgoing';

export interface RecurringEvidence {
	transactionId: string;
	bookingDate: string;
	amountCents: number;
	payee: string | null;
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
	profileId: string | null;
	profileLabel: string | null;
	categoryId: string | null;
	categoryName: string | null;
	label: string | null;
	payee: string;
	direction: RecurringDirection | null;
	canonicalPayeeKey: string;
	cadence: RecurringCadence;
	expectedAmountCents: number;
	nextDate: string | null;
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
	profileId?: string | null;
	categoryId?: string | null;
	label?: string | null;
	payee?: string;
	direction?: RecurringDirection;
	cadence?: RecurringCadence;
	expectedAmountCents?: number;
	nextDate?: string | null;
	status?: RecurringStatus;
	confidence?: number;
	source?: RecurringSource;
}
