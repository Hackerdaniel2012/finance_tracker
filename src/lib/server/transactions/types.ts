export type TransactionClassificationStatus = 'unknown' | 'auto' | 'manual' | 'ignored';
export type TransactionSort = 'booking_date' | 'amount_cents' | 'payee';
export type SortDirection = 'asc' | 'desc';

export interface TransactionTag {
	id: string;
	name: string;
	color: string | null;
}

export interface Transaction {
	id: string;
	profileId: string;
	accountId: string;
	accountName: string;
	importBatchId: string | null;
	categoryId: string | null;
	categoryName: string | null;
	dedupeKey: string;
	bookingDate: string;
	valueDate: string | null;
	amountCents: number;
	currency: 'EUR';
	originalAmountCents: number | null;
	originalCurrency: string | null;
	exchangeRate: string | null;
	balanceAfterCents: number | null;
	payee: string | null;
	description: string | null;
	note: string | null;
	searchText: string;
	classificationStatus: TransactionClassificationStatus;
	tags: TransactionTag[];
	reviewFlag: {
		id: string;
		reason: string;
		status: string;
	} | null;
	createdAt: string;
	updatedAt: string;
}

export interface TransactionListFilters {
	accountId?: string;
	profileId?: string;
	categoryId?: string;
	status?: TransactionClassificationStatus;
	search?: string;
	from?: string;
	to?: string;
	sort: TransactionSort;
	direction: SortDirection;
	limit: number;
	offset: number;
}

export interface TransactionListResult {
	transactions: Transaction[];
	pagination: {
		limit: number;
		offset: number;
		total: number;
	};
}

export interface UpdateTransactionInput {
	id: string;
	categoryId?: string | null;
	note?: string | null;
	tagNames?: string[];
	createRule?: boolean;
	ruleName?: string;
}
