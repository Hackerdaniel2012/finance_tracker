import type { BankId, NormalizedTransaction, ParseError } from '$lib/banks';
import type { DuplicateImportRow } from './deduplication';

export interface ImportPreviewInput {
	accountId: string;
	adapterId: string;
	csv: string;
}

export interface ImportPreview {
	accountId: string;
	adapterId: BankId;
	fileHash: string;
	summary: {
		parsedRows: number;
		skippedRows: number;
		errorCount: number;
		duplicateEstimate: number;
		startDate: string | null;
		endDate: string | null;
	};
	metadata: Record<string, string>;
	sampleRows: NormalizedTransaction[];
	duplicateRows: DuplicateImportRow[];
	errors: ParseError[];
}

export interface ConfirmImportInput {
	accountId: string;
	adapterId: string;
	csv: string;
	expectedHash: string;
}

export interface ImportReport {
	batchId: string;
	accountId: string;
	adapterId: BankId;
	fileHash: string;
	startDate: string | null;
	endDate: string | null;
	rowCount: number;
	importedCount: number;
	duplicateCount: number;
	errorCount: number;
	unknownCount: number;
}

export interface ImportBatch {
	id: string;
	accountId: string;
	accountName: string;
	adapterId: BankId;
	fileHash: string;
	startDate: string | null;
	endDate: string | null;
	rowCount: number;
	importedCount: number;
	duplicateCount: number;
	errorCount: number;
	createdAt: string;
}
