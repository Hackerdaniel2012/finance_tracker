import type { BankId, NormalizedTransaction, ParseError } from '$lib/banks';
import type { DuplicateImportRow } from './deduplication';

export interface ImportPreviewInput {
	accountId: string;
	adapterId: string;
	csv: string;
	combineBeforeDate?: string | null;
}

export interface CombinedImportRow {
	subaccount: string | null;
	bookingDate: string;
	amountCents: number;
	sourceRowCount: number;
}

export interface ImportPreview {
	accountId: string;
	adapterId: BankId;
	fileHash: string;
	combineBeforeDate: string | null;
	summary: {
		parsedRows: number;
		skippedRows: number;
		errorCount: number;
		duplicateEstimate: number;
		startDate: string | null;
		endDate: string | null;
		combinedSourceCount: number;
		combinedRecordCount: number;
		detailedImportCount: number;
		effectiveImportCount: number;
	};
	metadata: Record<string, string>;
	sampleRows: NormalizedTransaction[];
	combinedRows: CombinedImportRow[];
	duplicateRows: DuplicateImportRow[];
	errors: ParseError[];
}

export interface ConfirmImportInput {
	accountId: string;
	adapterId: string;
	csv: string;
	expectedHash: string;
	combineBeforeDate?: string | null;
}

export interface ImportReport {
	batchId: string;
	accountId: string;
	adapterId: BankId;
	fileHash: string;
	combineBeforeDate: string | null;
	startDate: string | null;
	endDate: string | null;
	rowCount: number;
	importedCount: number;
	duplicateCount: number;
	errorCount: number;
	unknownCount: number;
	combinedSourceCount: number;
	combinedRecordCount: number;
	detailedImportCount: number;
}

export interface ImportBatch {
	id: string;
	accountId: string;
	accountName: string;
	adapterId: BankId;
	fileHash: string;
	combineBeforeDate: string | null;
	startDate: string | null;
	endDate: string | null;
	rowCount: number;
	importedCount: number;
	duplicateCount: number;
	errorCount: number;
	combinedSourceCount: number;
	combinedRecordCount: number;
	detailedImportCount: number;
	createdAt: string;
}
