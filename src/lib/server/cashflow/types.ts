import type { UpcomingIncome, UpcomingPayment } from '../../cashflow';
export type { MonthCashflowReport, UpcomingIncome, UpcomingPayment } from '../../cashflow';
export interface CashflowWindow {
	asOf: string;
	monthEnd: string;
	nextIncomeDate: string | null;
	accountId?: string;
}
export interface BalanceBeforeIncomeProjection {
	asOf: string;
	projectionDate: string;
	manualNextIncomeDate: string | null;
	nextIncome: UpcomingIncome | null;
	currentBalanceCents: number;
	upcomingPaymentCents: number;
	projectedBalanceCents: number;
	uninitializedAccountIds: string[];
	upcomingPayments: UpcomingPayment[];
	accountProjections: BalanceBeforeIncomeAccountProjection[];
}
export interface BalanceBeforeIncomeAccountProjection {
	accountId: string;
	accountName: string;
	currentBalanceCents: number | null;
	balanceInitialized: boolean;
	upcomingPaymentCents: number;
	projectedBalanceCents: number | null;
}
