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
