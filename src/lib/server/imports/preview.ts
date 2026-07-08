import { getBankAdapter } from '$lib/banks';
import type { DbClient, DbRow } from '../db-client';
import { NotFoundError, ValidationError } from '../accounts/errors';
import { getProfile } from '../accounts/repository';
import type { ImportPreview, ImportPreviewInput } from './types';

const sampleRowLimit = 5;

export async function previewImport(
	db: DbClient,
	input: ImportPreviewInput
): Promise<ImportPreview> {
	const profileId = input.profileId.trim();
	if (!profileId) {
		throw new ValidationError('profileId is required');
	}

	if (!input.csv.trim()) {
		throw new ValidationError('CSV file is required');
	}

	const profile = await getProfile(db, profileId);
	if (!profile) {
		throw new NotFoundError('Import profile not found');
	}

	const adapter = getBankAdapter(profile.bankId);
	const parsed = adapter.parse(input.csv);
	const duplicateEstimate = await countExistingTransactions(
		db,
		profile.id,
		parsed.rows.map((row) => row.dedupeKey)
	);
	const { startDate, endDate } = getDateRange(parsed.rows.map((row) => row.bookingDate));

	return {
		profileId: profile.id,
		adapterId: adapter.id,
		fileHash: await sha256Hex(input.csv),
		summary: {
			parsedRows: parsed.rows.length,
			skippedRows: parsed.skippedRows,
			errorCount: parsed.errors.length,
			duplicateEstimate,
			startDate,
			endDate
		},
		metadata: parsed.metadata ?? {},
		sampleRows: parsed.rows.slice(0, sampleRowLimit),
		errors: parsed.errors
	};
}

async function countExistingTransactions(
	db: DbClient,
	profileId: string,
	dedupeKeys: string[]
): Promise<number> {
	const uniqueKeys = [...new Set(dedupeKeys)];
	if (uniqueKeys.length === 0) {
		return 0;
	}

	const placeholders = uniqueKeys.map(() => '?').join(', ');
	const row = await db
		.prepare(
			`SELECT COUNT(*) AS count
			FROM transactions
			WHERE profile_id = ?
				AND dedupe_key IN (${placeholders})`
		)
		.bind(profileId, ...uniqueKeys)
		.first<CountRow>();

	return Number(row?.count ?? 0);
}

function getDateRange(dates: string[]): { startDate: string | null; endDate: string | null } {
	if (dates.length === 0) {
		return { startDate: null, endDate: null };
	}

	const sorted = [...dates].sort();
	return {
		startDate: sorted[0] ?? null,
		endDate: sorted.at(-1) ?? null
	};
}

async function sha256Hex(value: string): Promise<string> {
	const bytes = new TextEncoder().encode(value);
	const digest = await crypto.subtle.digest('SHA-256', bytes);

	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

interface CountRow extends DbRow {
	count: number;
}
