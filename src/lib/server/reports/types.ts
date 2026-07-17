export interface ReportDateRange {
	from: string;
	to: string;
}

export interface SummaryReportOptions {
	accountId?: string;
}

export interface NetWorthReportOptions {
	accountId?: string;
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
		expenseCents: number;
		incomeCents: number;
		netCents: number;
		transactionCount: number;
	}>;
	byMonthCategory: Array<{
		month: string;
		categoryId: string | null;
		categoryName: string;
		expenseCents: number;
	}>;
	byAccount: Array<{
		accountId: string;
		accountName: string;
		balanceCents: number | null;
		balanceInitialized: boolean;
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
		balanceCents: number | null;
		balanceInitialized: boolean;
	}>;
	liabilities: Array<{
		id: string;
		name: string;
		amountCents: number;
		asOfDate: string;
	}>;
}
