export interface CashflowWindow {
	asOf: string;
	monthEnd: string;
}

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

export interface BalanceBeforeSalaryProjection {
	asOf: string;
	projectionDate: string;
	nextIncome: UpcomingIncome | null;
	currentBalanceCents: number;
	upcomingPaymentCents: number;
	projectedBalanceCents: number;
	upcomingPayments: UpcomingPayment[];
}
