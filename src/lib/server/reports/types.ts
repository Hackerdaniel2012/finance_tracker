export interface ReportDateRange {
	from: string;
	to: string;
}

export interface SummaryReportOptions {
	accountId?: string;
	subaccount?: string;
}

export interface NetWorthReportOptions {
	accountId?: string;
	subaccount?: string;
}

export interface AccountBalanceHistoryReport {
	accountId: string;
	accountName: string;
	range: ReportDateRange;
	points: Array<{
		date: string;
		balanceCents: number;
	}>;
}

export interface SummaryReport {
	range: ReportDateRange;
	totals: {
		incomeCents: number;
		expenseCents: number;
		netCents: number;
		transactionCount: number;
		unknownCount: number;
	};
	byCategory: Array<{
		categoryId: string | null;
		categoryName: string;
		type: string;
		amountCents: number;
		transactionCount: number;
	}>;
	byAccount: Array<{
		accountId: string;
		accountName: string;
		balanceCents: number;
		incomeCents: number;
		expenseCents: number;
		netCents: number;
	}>;
	recentTransactions: Array<{
		id: string;
		accountName: string;
		categoryName: string | null;
		bookingDate: string;
		amountCents: number;
		payee: string | null;
		classificationStatus: string;
	}>;
}

export interface NetWorthReport {
	points: Array<{
		date: string;
		assetsCents: number;
		liabilitiesCents: number;
		netWorthCents: number;
	}>;
	accounts: Array<{
		accountId: string;
		accountName: string;
		balanceCents: number;
	}>;
	liabilities: Array<{
		id: string;
		name: string;
		amountCents: number;
		asOfDate: string;
	}>;
}
