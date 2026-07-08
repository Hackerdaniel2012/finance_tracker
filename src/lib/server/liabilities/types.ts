export type LiabilityStatus = 'active' | 'cleared';

export interface Liability {
	id: string;
	accountId: string | null;
	accountName: string | null;
	name: string;
	amountCents: number;
	asOfDate: string;
	status: LiabilityStatus;
	note: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface CreateLiabilityInput {
	accountId?: string | null;
	name: string;
	amountCents: number;
	asOfDate: string;
	status?: LiabilityStatus;
	note?: string | null;
}

export interface UpdateLiabilityInput {
	id: string;
	accountId?: string | null;
	name?: string;
	amountCents?: number;
	asOfDate?: string;
	status?: LiabilityStatus;
	note?: string | null;
}
