import type { NormalizedTransaction } from '$lib/banks';
import { describe, expect, it } from 'vitest';
import {
	partitionImportRows,
	type ExistingDuplicateTransaction
} from './deduplication';

describe('partitionImportRows', () => {
	it('matches DKB rows whose source reference changed', () => {
		const incoming = transaction({ dedupeKey: 'dkb_ref:new-reference' });
		const existing = existingTransaction({ dedupeKey: 'dkb_ref:old-reference' });

		const result = partitionImportRows([incoming], new Map(), giroCandidates([existing]));

		expect(result.rows).toEqual([]);
		expect(result.duplicates).toMatchObject([
			{ reason: 'existing_transaction', existingTransaction: { id: existing.id } }
		]);
	});

	it('accepts a conservatively truncated DKB purpose as the same transaction', () => {
		const sharedPurpose =
			'Kartenzahlung Referenz 123456789 Buchungstext mit ausreichend eindeutigen Angaben';
		const incoming = transaction({ description: `${sharedPurpose} Ausgang DE00123456789012345678` });
		const existing = existingTransaction({
			description: `${sharedPurpose} und zusaetzlichen Angaben aus dem Webexport`
		});

		const result = partitionImportRows([incoming], new Map(), giroCandidates([existing]));

		expect(result.rows).toEqual([]);
		expect(result.duplicates).toHaveLength(1);
	});

	it('does not merge equal amounts with different purposes', () => {
		const incoming = transaction({ description: 'Einkauf bei Haendler Alpha Referenz 123456' });
		const existing = existingTransaction({
			description: 'Einkauf bei Haendler Beta Referenz 987654'
		});

		const result = partitionImportRows([incoming], new Map(), giroCandidates([existing]));

		expect(result.rows).toEqual([incoming]);
		expect(result.duplicates).toEqual([]);
	});

	it('accepts a one-day booking shift when value date, amount and full purpose match', () => {
		const incoming = transaction();
		const existing = existingTransaction({ bookingDate: '2026-07-31' });

		const result = partitionImportRows([incoming], new Map(), giroCandidates([existing]));

		expect(result.rows).toEqual([]);
		expect(result.duplicates).toHaveLength(1);
	});

	it('does not combine a booking shift with a truncated purpose', () => {
		const incoming = transaction({ description: 'Kartenzahlung Referenz 123456789' });
		const existing = existingTransaction({ bookingDate: '2026-07-31' });

		const result = partitionImportRows([incoming], new Map(), giroCandidates([existing]));

		expect(result.rows).toEqual([incoming]);
		expect(result.duplicates).toEqual([]);
	});

	it('matches each existing transaction at most once', () => {
		const first = transaction({ dedupeKey: 'dkb_ref:first', sourceRowNumber: 2 });
		const second = transaction({ dedupeKey: 'dkb_ref:second', sourceRowNumber: 3 });
		const existing = existingTransaction();

		const result = partitionImportRows([first, second], new Map(), giroCandidates([existing]));

		expect(result.duplicates).toHaveLength(1);
		expect(result.rows).toHaveLength(1);
		expect(result.rows[0].dedupeKey).toBe('dkb_ref:second');
	});

	it('requires booking date, value date and amount to match', () => {
		const incoming = transaction();
		const candidates = [
			existingTransaction({ id: 'different-booking-date', bookingDate: '2026-08-03' }),
			existingTransaction({ id: 'different-value-date', valueDate: '2026-08-02' }),
			existingTransaction({ id: 'different-amount', amountCents: -4201 })
		];

		const result = partitionImportRows([incoming], new Map(), giroCandidates(candidates));

		expect(result.rows).toEqual([incoming]);
		expect(result.duplicates).toEqual([]);
	});

	it('matches DKB credit-card exports across a two-day booking-date shift', () => {
		const incoming = transaction({
			bookingDate: '2026-08-01',
			dedupeKey: 'fetch-fingerprint',
			source: { bankId: 'dkb_creditcard', rowNumber: 2, rawType: 'CreditCard' }
		});
		const existing = existingTransaction({
			bookingDate: '2026-08-03',
			dedupeKey: 'web-fingerprint'
		});

		const result = partitionImportRows([incoming], new Map(), {
			adapterId: 'dkb_creditcard',
			candidates: [existing]
		});

		expect(result.rows).toEqual([]);
		expect(result.duplicates).toHaveLength(1);
	});

	it('keeps credit-card rows with a larger date shift or different description', () => {
		const incoming = transaction({
			source: { bankId: 'dkb_creditcard', rowNumber: 2, rawType: 'CreditCard' }
		});
		const candidates = [
			existingTransaction({ id: 'three-days-later', bookingDate: '2026-08-04' }),
			existingTransaction({ id: 'different-description', description: 'Anderer Haendler' })
		];

		const result = partitionImportRows([incoming], new Map(), {
			adapterId: 'dkb_creditcard',
			candidates
		});

		expect(result.rows).toEqual([incoming]);
		expect(result.duplicates).toEqual([]);
	});
});

function giroCandidates(candidates: ExistingDuplicateTransaction[]) {
	return { adapterId: 'dkb_girocard' as const, candidates };
}

function transaction(
	overrides: Partial<NormalizedTransaction> & { sourceRowNumber?: number } = {}
): NormalizedTransaction {
	const { sourceRowNumber = 2, ...transactionOverrides } = overrides;
	return {
		bookingDate: '2026-08-01',
		valueDate: '2026-08-01',
		amountCents: -4200,
		currency: 'EUR',
		description: 'Kartenzahlung Referenz 123456789 Buchungstext mit eindeutigen Angaben',
		searchText: '',
		dedupeKey: 'dkb_ref:incoming',
		source: {
			bankId: 'dkb_girocard',
			rowNumber: sourceRowNumber
		},
		...transactionOverrides
	};
}

function existingTransaction(
	overrides: Partial<ExistingDuplicateTransaction> = {}
): ExistingDuplicateTransaction {
	return {
		id: 'existing-transaction',
		bookingDate: '2026-08-01',
		valueDate: '2026-08-01',
		amountCents: -4200,
		payee: null,
		description: 'Kartenzahlung Referenz 123456789 Buchungstext mit eindeutigen Angaben',
		dedupeKey: 'dkb_ref:existing',
		...overrides
	};
}
