import type { UpcomingIncome, UpcomingPayment } from '../../cashflow';

export type { MonthCashflowReport, UpcomingIncome, UpcomingPayment } from '../../cashflow';

export interface CashflowWindow {
	asOf: string;
	monthEnd: string;
	nextSalaryDate: string | null;
	accountId?: string;
	subaccount?: string;
}

export interface BalanceBeforeSalaryProjection {
	asOf: string;
	projectionDate: string;
	manualNextSalaryDate: string | null;
	nextIncome: UpcomingIncome | null;
	currentBalanceCents: number;
	upcomingPaymentCents: number;
	projectedBalanceCents: number;
	upcomingPayments: UpcomingPayment[];
	accountProjections: BalanceBeforeSalaryAccountProjection[];
}

export interface BalanceBeforeSalaryAccountProjection {
	accountId: string;
	accountName: string;
	currentBalanceCents: number;
	upcomingPaymentCents: number;
	projectedBalanceCents: number;
}
