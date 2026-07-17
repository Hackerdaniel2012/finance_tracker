import type { BankId, NormalizedTransaction, ParseError } from '$lib/banks';
import type { DuplicateImportRow } from './deduplication';

export type ImportBalanceMode = 'reported' | 'complete_history';

export interface ImportAccountAssignment {
	sourceAccountKey: string | null;
	targetAccountId?: string;
	newAccount?: {
		name: string;
		institution: string | null;
	};
	balanceMode: ImportBalanceMode;
	reportedBalanceCents?: number;
}

export interface ImportPreviewInput {
	adapterId: string;
	csv: string;
	assignments?: ImportAccountAssignment[];
}

export interface ImportAccountPreview {
	sourceAccountKey: string | null;
	sourceAccountLabel: string;
	stableSourceKey: boolean;
	suggestedAccountId: string | null;
	suggestedName: string;
	rowCount: number;
	startDate: string | null;
	endDate: string | null;
	sampleRows: NormalizedTransaction[];
	assignment: ImportAccountAssignment | null;
	targetAccountName: string | null;
	targetBalanceInitialized: boolean;
	importableRowCount: number | null;
	duplicateRows: DuplicateImportRow[];
	calculatedBalanceCents: number | null;
	differenceCents: number | null;
	balanceMatches: boolean;
}

export interface ImportPreview {
	adapterId: BankId;
	fileHash: string;
	configurationHash: string | null;
	readyToConfirm: boolean;
	summary: {
		parsedRows: number;
		skippedRows: number;
		errorCount: number;
		accountCount: number;
		duplicateEstimate: number;
		startDate: string | null;
		endDate: string | null;
	};
	metadata: Record<string, string>;
	accounts: ImportAccountPreview[];
	errors: ParseError[];
}

export interface ConfirmImportInput {
	adapterId: string;
	csv: string;
	expectedHash: string;
	expectedConfigurationHash: string;
	assignments: ImportAccountAssignment[];
}

export interface ImportAccountReport {
	batchId: string;
	accountId: string;
	accountName: string;
	createdAccount: boolean;
	sourceAccountKey: string | null;
	startDate: string | null;
	endDate: string | null;
	rowCount: number;
	importedCount: number;
	duplicateCount: number;
	unknownCount: number;
	balanceMode: ImportBalanceMode;
	reportedBalanceCents: number;
	calculatedBalanceCents: number | null;
}

export interface ImportReport {
	runId: string;
	adapterId: BankId;
	fileHash: string;
	startDate: string | null;
	endDate: string | null;
	rowCount: number;
	importedCount: number;
	duplicateCount: number;
	errorCount: number;
	unknownCount: number;
	accounts: ImportAccountReport[];
}

export interface ImportRunAccount {
	accountId: string;
	accountName: string;
	importedCount: number;
}

export interface ImportRun {
	id: string;
	adapterId: BankId;
	fileHash: string;
	startDate: string | null;
	endDate: string | null;
	rowCount: number;
	importedCount: number;
	duplicateCount: number;
	errorCount: number;
	accounts: ImportRunAccount[];
	canDelete: boolean;
	createdAt: string;
}
