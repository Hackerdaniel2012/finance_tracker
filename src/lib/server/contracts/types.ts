export type ContractKind = 'fixed_cost' | 'subscription' | 'salary' | 'income' | 'other';
export type ContractCadence = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';
export type ContractStatus = 'active' | 'paused' | 'ended';
export type ContractSource = 'manual' | 'imported' | 'confirmed_recurring';

export interface Contract {
	id: string;
	accountId: string | null;
	accountName: string | null;
	profileId: string | null;
	profileLabel: string | null;
	categoryId: string | null;
	categoryName: string | null;
	name: string;
	payee: string | null;
	kind: ContractKind;
	cadence: ContractCadence;
	expectedAmountCents: number;
	nextDate: string;
	endDate: string | null;
	status: ContractStatus;
	source: ContractSource;
	createdAt: string;
	updatedAt: string;
}

export interface CreateContractInput {
	accountId?: string | null;
	profileId?: string | null;
	categoryId?: string | null;
	name: string;
	payee?: string | null;
	kind: ContractKind;
	cadence: ContractCadence;
	expectedAmountCents: number;
	nextDate: string;
	endDate?: string | null;
	status?: ContractStatus;
	source?: ContractSource;
}

export interface UpdateContractInput {
	id: string;
	accountId?: string | null;
	profileId?: string | null;
	categoryId?: string | null;
	name?: string;
	payee?: string | null;
	kind?: ContractKind;
	cadence?: ContractCadence;
	expectedAmountCents?: number;
	nextDate?: string;
	endDate?: string | null;
	status?: ContractStatus;
	source?: ContractSource;
}
