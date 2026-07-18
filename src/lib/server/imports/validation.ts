import { ValidationError } from '../accounts/errors';
import type { ImportAccountAssignment } from './types';

export function parseImportAccountAssignmentsJson(value: string): ImportAccountAssignment[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		throw new ValidationError('assignments must be valid JSON');
	}
	return parseImportAccountAssignments(parsed);
}

export function parseImportAccountAssignments(value: unknown): ImportAccountAssignment[] {
	if (!Array.isArray(value)) {
		throw new ValidationError('assignments must be a JSON array');
	}
	return value.map((assignment, index) => parseAssignment(assignment, index));
}

function parseAssignment(value: unknown, index: number): ImportAccountAssignment {
	const body = asObject(value, `assignments[${index}]`);
	const sourceAccountKey = parseSourceAccountKey(body.sourceAccountKey, index);
	const hasTarget = Object.hasOwn(body, 'targetAccountId');
	const hasNewAccount = Object.hasOwn(body, 'newAccount');
	if (hasTarget === hasNewAccount) {
		throw new ValidationError(
			`assignments[${index}] must target either an existing or a new account`
		);
	}

	const balanceMode = body.balanceMode;
	if (
		balanceMode !== 'reported' &&
		balanceMode !== 'complete_history' &&
		balanceMode !== 'continue_from_snapshot'
	) {
		throw new ValidationError(`assignments[${index}].balanceMode is invalid`);
	}
	if (Object.hasOwn(body, 'reportedBalanceCents') && !Number.isInteger(body.reportedBalanceCents)) {
		throw new ValidationError(`assignments[${index}].reportedBalanceCents must be an integer`);
	}
	if (balanceMode === 'reported' && !Number.isInteger(body.reportedBalanceCents)) {
		throw new ValidationError(`assignments[${index}].reportedBalanceCents is required`);
	}

	const result: ImportAccountAssignment = { sourceAccountKey, balanceMode };
	if (balanceMode === 'reported') {
		result.reportedBalanceCents = body.reportedBalanceCents as number;
	}
	if (hasTarget) {
		if (typeof body.targetAccountId !== 'string' || body.targetAccountId.trim() === '') {
			throw new ValidationError(`assignments[${index}].targetAccountId is invalid`);
		}
		result.targetAccountId = body.targetAccountId.trim();
	} else {
		if (balanceMode === 'continue_from_snapshot') {
			throw new ValidationError(`assignments[${index}].balanceMode requires an existing account`);
		}
		const newAccount = asObject(body.newAccount, `assignments[${index}].newAccount`);
		if (typeof newAccount.name !== 'string' || newAccount.name.trim() === '') {
			throw new ValidationError(`assignments[${index}].newAccount.name is required`);
		}
		if (newAccount.institution !== null && typeof newAccount.institution !== 'string') {
			throw new ValidationError(
				`assignments[${index}].newAccount.institution must be a string or null`
			);
		}
		result.newAccount = {
			name: newAccount.name.trim(),
			institution: newAccount.institution?.trim() || null
		};
	}
	return result;
}

function parseSourceAccountKey(value: unknown, index: number): string | null {
	if (value === null) return null;
	if (typeof value !== 'string') {
		throw new ValidationError(`assignments[${index}].sourceAccountKey must be a string or null`);
	}
	return value.trim() || null;
}

function asObject(value: unknown, field: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new ValidationError(`${field} must be an object`);
	}
	return value as Record<string, unknown>;
}
