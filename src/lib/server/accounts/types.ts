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

export interface AccountWithBalance extends Account {
	balanceCents: number;
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
