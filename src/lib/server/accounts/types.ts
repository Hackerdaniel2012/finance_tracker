export interface Account {
	id: string;
	name: string;
	institution: string | null;
	currency: 'EUR';
	displayOrder: number;
	createdAt: string;
	updatedAt: string;
}

export interface AccountWithBalance extends Account {
	balanceCents: number | null;
	balanceInitialized: boolean;
}

export interface CreateAccountInput {
	name: string;
	institution?: string | null;
	displayOrder?: number;
}

export interface UpdateAccountInput {
	id: string;
	name?: string;
	institution?: string | null;
	displayOrder?: number;
}
