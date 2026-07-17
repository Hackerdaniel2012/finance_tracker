import { getBankAdapter, type BankId, type NormalizedTransaction } from '$lib/banks';
import { ConflictError, NotFoundError, ValidationError } from '../accounts/errors';
import { calculateBalanceAfterCandidates, getLatestBalanceSnapshot } from '../accounts/balance';
import { getAccount } from '../accounts/repository';
import type { DbClient, DbRow } from '../db-client';
import { getExistingTransactionsByDedupeKey, partitionImportRows } from './deduplication';
import { getDateRange, sha256Hex } from './shared';
import type {
	ImportAccountAssignment,
	ImportAccountPreview,
	ImportPreview,
	ImportPreviewInput
} from './types';
import { parseImportAccountAssignments } from './validation';

const sampleRowLimit = 5;
const keylessGroup = '\u0000single-account';

export interface PreparedImportGroup {
	preview: ImportAccountPreview;
	rows: NormalizedTransaction[];
}

export interface PreparedImport {
	preview: ImportPreview;
	groups: PreparedImportGroup[];
}

export async function prepareImport(
	db: DbClient,
	input: ImportPreviewInput
): Promise<PreparedImport> {
	if (!input.csv.trim()) throw new ValidationError('CSV file is required');
	const adapter = getAdapter(input.adapterId);
	const parsed = adapter.parse(input.csv);
	const groups = groupRows(parsed.rows);
	const mappings = await getMappings(db, adapter.id);
	const parsedAssignments =
		input.assignments === undefined ? null : parseImportAccountAssignments(input.assignments);
	const assignments = parsedAssignments ? validateAssignmentSet(parsedAssignments, groups) : null;
	const preparedGroups: PreparedImportGroup[] = [];

	for (const group of groups) {
		const assignment = assignments?.get(groupKey(group.sourceAccountKey)) ?? null;
		preparedGroups.push(
			await prepareGroup(
				db,
				adapter.label,
				group,
				assignment,
				mappings.get(group.sourceAccountKey ?? '')
			)
		);
	}

	const range = getDateRange(parsed.rows.map((row) => row.bookingDate));
	const duplicateEstimate = preparedGroups.reduce(
		(sum, group) => sum + group.preview.duplicateRows.length,
		0
	);
	return {
		groups: preparedGroups,
		preview: {
			adapterId: adapter.id,
			fileHash: await sha256Hex(input.csv),
			configurationHash: assignments
				? await sha256Hex(
						JSON.stringify(groups.map((group) => assignments.get(groupKey(group.sourceAccountKey))))
					)
				: null,
			readyToConfirm: assignments !== null,
			summary: {
				parsedRows: parsed.rows.length,
				skippedRows: parsed.skippedRows,
				errorCount: parsed.errors.length,
				accountCount: groups.length,
				duplicateEstimate,
				...range
			},
			metadata: parsed.metadata ?? {},
			accounts: preparedGroups.map((group) => group.preview),
			errors: parsed.errors
		}
	};
}

async function prepareGroup(
	db: DbClient,
	adapterLabel: string,
	group: GroupedRows,
	assignment: ImportAccountAssignment | null,
	suggestedAccountId: string | undefined
): Promise<PreparedImportGroup> {
	const range = getDateRange(group.rows.map((row) => row.bookingDate));
	const base: ImportAccountPreview = {
		sourceAccountKey: group.sourceAccountKey,
		sourceAccountLabel: group.label,
		stableSourceKey: group.sourceAccountKey !== null,
		suggestedAccountId: suggestedAccountId ?? null,
		suggestedName: group.label || adapterLabel,
		rowCount: group.rows.length,
		...range,
		sampleRows: group.rows.slice(0, sampleRowLimit),
		assignment,
		targetAccountName: null,
		targetBalanceInitialized: false,
		importableRowCount: null,
		duplicateRows: [],
		calculatedBalanceCents: null,
		differenceCents: null,
		balanceMatches: true
	};
	if (!assignment) return { preview: base, rows: group.rows };

	let account = null;
	if (assignment.targetAccountId) {
		account = await getAccount(db, assignment.targetAccountId);
		if (!account) throw new NotFoundError('Target account not found');
	} else {
		validateNewAccount(assignment);
	}

	const existing = account
		? await getExistingTransactionsByDedupeKey(
				db,
				account.id,
				group.rows.map((row) => row.dedupeKey)
			)
		: new Map();
	const partition = partitionImportRows(group.rows, existing);
	const snapshot = account ? await getLatestBalanceSnapshot(db, account.id) : null;
	if (snapshot && assignment.balanceMode !== 'reported') {
		throw new ValidationError('Initialized accounts require a reported balance');
	}

	let calculatedBalanceCents: number | null = null;
	let reportedBalanceCents: number;
	if (assignment.balanceMode === 'complete_history') {
		if (!range.endDate) throw new ValidationError('Account group has no valid rows');
		const existingTotal = account ? await getTransactionTotal(db, account.id, range.endDate) : 0;
		calculatedBalanceCents =
			existingTotal + partition.rows.reduce((sum, row) => sum + row.amountCents, 0);
		reportedBalanceCents = calculatedBalanceCents;
	} else {
		if (!Number.isInteger(assignment.reportedBalanceCents)) {
			throw new ValidationError('reportedBalanceCents must be an integer');
		}
		reportedBalanceCents = assignment.reportedBalanceCents!;
		calculatedBalanceCents = snapshot
			? await calculateBalanceAfterCandidates(db, account!.id, partition.rows)
			: null;
	}
	const differenceCents =
		calculatedBalanceCents === null ? null : reportedBalanceCents - calculatedBalanceCents;
	if (snapshot && differenceCents !== 0) {
		throw new ConflictError('Reported balance does not match the calculated balance');
	}

	return {
		preview: {
			...base,
			targetAccountName: account?.name ?? assignment.newAccount!.name.trim(),
			targetBalanceInitialized: snapshot !== null,
			importableRowCount: partition.rows.length,
			duplicateRows: partition.duplicates,
			calculatedBalanceCents,
			differenceCents,
			balanceMatches: differenceCents === null || differenceCents === 0
		},
		rows: partition.rows
	};
}

function validateAssignmentSet(
	assignments: ImportAccountAssignment[],
	groups: GroupedRows[]
): Map<string, ImportAccountAssignment> {
	if (assignments.length !== groups.length) {
		throw new ValidationError('Every detected account must be assigned exactly once');
	}
	const result = new Map<string, ImportAccountAssignment>();
	const targetIds = new Set<string>();
	for (const rawAssignment of assignments) {
		let assignment = rawAssignment;
		const key = groupKey(assignment.sourceAccountKey);
		if (result.has(key) || !groups.some((group) => groupKey(group.sourceAccountKey) === key)) {
			throw new ValidationError('Account assignments do not match the detected CSV accounts');
		}
		const hasExisting =
			typeof assignment.targetAccountId === 'string' && assignment.targetAccountId.trim() !== '';
		const hasNew = assignment.newAccount !== undefined;
		if (hasExisting === hasNew) {
			throw new ValidationError('Each group must target either an existing or a new account');
		}
		if (hasExisting) {
			const id = assignment.targetAccountId!.trim();
			if (targetIds.has(id))
				throw new ValidationError('Each group must use a different target account');
			targetIds.add(id);
			assignment = { ...assignment, targetAccountId: id };
		}
		if (assignment.balanceMode !== 'reported' && assignment.balanceMode !== 'complete_history') {
			throw new ValidationError('balanceMode is invalid');
		}
		result.set(key, assignment);
	}
	return result;
}

function validateNewAccount(assignment: ImportAccountAssignment): void {
	if (!assignment.newAccount?.name.trim())
		throw new ValidationError('New account name is required');
	if (
		assignment.newAccount.institution !== null &&
		typeof assignment.newAccount.institution !== 'string'
	) {
		throw new ValidationError('New account institution must be a string or null');
	}
}

function groupRows(rows: NormalizedTransaction[]): GroupedRows[] {
	const grouped = new Map<string, GroupedRows>();
	for (const row of rows) {
		const sourceAccountKey = row.source.sourceAccountKey?.trim() || null;
		const key = groupKey(sourceAccountKey);
		const existing = grouped.get(key);
		if (existing) existing.rows.push(row);
		else
			grouped.set(key, {
				sourceAccountKey,
				label: row.source.sourceAccountLabel?.trim() || sourceAccountKey || 'CSV account',
				rows: [row]
			});
	}
	return [...grouped.values()];
}

function groupKey(value: string | null): string {
	return value === null ? keylessGroup : `key:${value}`;
}

async function getMappings(db: DbClient, adapterId: BankId): Promise<Map<string, string>> {
	const { results } = await db
		.prepare(
			'SELECT source_account_key, account_id FROM import_account_mappings WHERE adapter_id = ?'
		)
		.bind(adapterId)
		.all<MappingRow>();
	return new Map(results.map((row) => [row.source_account_key, row.account_id]));
}

async function getTransactionTotal(
	db: DbClient,
	accountId: string,
	throughDate: string
): Promise<number> {
	const row = await db
		.prepare(
			`SELECT COALESCE(SUM(amount_cents), 0) AS total
			FROM transactions
			WHERE account_id = ? AND booking_date <= ?`
		)
		.bind(accountId, throughDate)
		.first<TotalRow>();
	return row?.total ?? 0;
}

function getAdapter(adapterId: string) {
	try {
		return getBankAdapter(adapterId as BankId);
	} catch {
		throw new ValidationError('adapterId is invalid');
	}
}

interface GroupedRows {
	sourceAccountKey: string | null;
	label: string;
	rows: NormalizedTransaction[];
}
interface MappingRow extends DbRow {
	source_account_key: string;
	account_id: string;
}
interface TotalRow extends DbRow {
	total: number;
}
