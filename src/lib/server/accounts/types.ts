import type { BankId } from '$lib/banks';

export interface Account {
	id: string;
	name: string;
	institution: string | null;
	currency: 'EUR';
	openingBalanceCents: number;
	currentBalanceCents: number | null;
	displayOrder: number;
	createdAt: string;
	updatedAt: string;
}

export interface ImportProfile {
	id: string;
	accountId: string;
	bankId: BankId;
	label: string;
	status: 'active' | 'archived';
	createdAt: string;
	updatedAt: string;
}

export interface AccountWithProfile extends Account {
	balanceCents: number;
	profile: ImportProfile | null;
	subaccounts: string[];
}

export interface CreateAccountInput {
	name: string;
	institution?: string | null;
	openingBalanceCents?: number;
	currentBalanceCents?: number | null;
	displayOrder?: number;
}

export interface UpdateAccountInput {
	id: string;
	name?: string;
	institution?: string | null;
	openingBalanceCents?: number;
	currentBalanceCents?: number | null;
	displayOrder?: number;
}

export interface CreateProfileInput {
	accountId: string;
	bankId: BankId;
	label: string;
}
