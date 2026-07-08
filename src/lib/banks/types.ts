export type BankId = 'n26' | 'trade_republic' | 'dkb';

export interface BankAdapter {
	id: BankId;
	label: string;
	status: 'enabled' | 'disabled';
	requiredColumns: string[];
	parse(csv: string): ParseResult;
}

export interface ParseResult {
	adapterId: BankId;
	rows: NormalizedTransaction[];
	errors: ParseError[];
	skippedRows: number;
	metadata?: Record<string, string>;
}

export interface ParseError {
	rowNumber: number;
	code: string;
	message: string;
}

export interface NormalizedTransaction {
	bookingDate: string;
	valueDate?: string;
	amountCents: number;
	currency: 'EUR';
	originalAmountCents?: number;
	originalCurrency?: string;
	exchangeRate?: string;
	balanceAfterCents?: number;
	payee?: string;
	description?: string;
	note?: string;
	searchText: string;
	dedupeKey: string;
	source: {
		bankId: BankId;
		rowNumber: number;
		rawType?: string;
		externalId?: string;
	};
}
