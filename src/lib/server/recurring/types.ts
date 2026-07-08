export type RecurringCadence = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';
export type RecurringStatus = 'suggested' | 'confirmed' | 'ignored';
export type RecurringSource = 'manual' | 'imported' | 'confirmed_suggestion';

export interface RecurringGroup {
	id: string;
	accountId: string | null;
	accountName: string | null;
	profileId: string | null;
	profileLabel: string | null;
	categoryId: string | null;
	categoryName: string | null;
	payee: string;
	cadence: RecurringCadence;
	expectedAmountCents: number;
	nextDate: string | null;
	status: RecurringStatus;
	confidence: number;
	source: RecurringSource;
	transactionCount: number;
	createdAt: string;
	updatedAt: string;
}

export interface UpdateRecurringGroupInput {
	id: string;
	accountId?: string | null;
	profileId?: string | null;
	categoryId?: string | null;
	payee?: string;
	cadence?: RecurringCadence;
	expectedAmountCents?: number;
	nextDate?: string | null;
	status?: RecurringStatus;
	confidence?: number;
	source?: RecurringSource;
}
