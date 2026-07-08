export type PlannedPaymentStatus = 'planned' | 'paid' | 'cancelled';
export type PlannedIncomeStatus = 'planned' | 'received' | 'cancelled';

interface PlannedBase {
	id: string;
	accountId: string | null;
	accountName: string | null;
	categoryId: string | null;
	categoryName: string | null;
	amountCents: number;
	dueDate: string;
	note: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface PlannedPayment extends PlannedBase {
	payee: string;
	status: PlannedPaymentStatus;
}

export interface PlannedIncome extends PlannedBase {
	payer: string;
	status: PlannedIncomeStatus;
}

export interface CreatePlannedPaymentInput {
	accountId?: string | null;
	categoryId?: string | null;
	payee: string;
	amountCents: number;
	dueDate: string;
	status?: PlannedPaymentStatus;
	note?: string | null;
}

export interface UpdatePlannedPaymentInput {
	id: string;
	accountId?: string | null;
	categoryId?: string | null;
	payee?: string;
	amountCents?: number;
	dueDate?: string;
	status?: PlannedPaymentStatus;
	note?: string | null;
}

export interface CreatePlannedIncomeInput {
	accountId?: string | null;
	categoryId?: string | null;
	payer: string;
	amountCents: number;
	dueDate: string;
	status?: PlannedIncomeStatus;
	note?: string | null;
}

export interface UpdatePlannedIncomeInput {
	id: string;
	accountId?: string | null;
	categoryId?: string | null;
	payer?: string;
	amountCents?: number;
	dueDate?: string;
	status?: PlannedIncomeStatus;
	note?: string | null;
}
