export interface UpcomingPayment {
	id: string;
	accountId: string | null;
	accountName: string | null;
	categoryId: string | null;
	categoryName: string | null;
	payee: string;
	amountCents: number;
	dueDate: string;
	note: string | null;
}

export interface UpcomingIncome {
	id: string;
	accountId: string | null;
	accountName: string | null;
	categoryId: string | null;
	categoryName: string | null;
	payer: string;
	amountCents: number;
	dueDate: string;
	note: string | null;
}

export interface MonthCashflowReport {
	range: {
		from: string;
		asOf: string;
		to: string;
	};
	actual: {
		incomeCents: number;
		expenseCents: number;
		netCents: number;
	};
	forecast: {
		incomeCents: number;
		paymentCents: number;
		netCents: number;
	};
	projectedNetCents: number;
	upcomingPayments: UpcomingPayment[];
	upcomingIncome: UpcomingIncome[];
}

export interface CategoryCostProjectionAmountSummary {
	actualCents: number;
	historicalAverageCents: number;
	plannedRemainingCents: number;
	committedCents: number;
	projectedCents: number;
	projectedRemainingCents: number;
}

export interface CategoryCostProjectionItem extends CategoryCostProjectionAmountSummary {
	categoryId: string;
	categoryName: string;
	categoryColor: string | null;
}

export interface CategoryCostProjectionReport {
	range: {
		from: string;
		asOf: string;
		to: string;
		historyFrom: string;
		historyTo: string;
		historyMonths: string[];
	};
	categories: CategoryCostProjectionItem[];
	totals: CategoryCostProjectionAmountSummary;
}
