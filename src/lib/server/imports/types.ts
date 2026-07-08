import type { BankId, NormalizedTransaction, ParseError } from '$lib/banks';

export interface ImportPreviewInput {
	profileId: string;
	csv: string;
}

export interface ImportPreview {
	profileId: string;
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
	errors: ParseError[];
}

export interface ConfirmImportInput {
	profileId: string;
	csv: string;
	expectedHash: string;
}

export interface ImportReport {
	batchId: string;
	profileId: string;
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
