import { findHeaderRow, missingRequiredColumns, parseDelimitedCsv } from './csv';
import {
	makeParseError,
	normalizeWhitespace,
	parseEuroCents,
	parseGermanShortDate,
	stableFingerprint
} from './normalize';
import type { BankAdapter, NormalizedTransaction, ParseError } from './types';

const requiredColumns = [
	'Belegdatum',
	'Wertstellung',
	'Status',
	'Beschreibung',
	'Umsatztyp',
	'Betrag (€)'
];

export const dkbCreditcardAdapter: BankAdapter = {
	id: 'dkb_creditcard',
	label: 'DKB Credit Card',
	status: 'enabled',
	requiredColumns,
	parse(csv) {
		const headerRowIndex = findHeaderRow(csv, 'Belegdatum', ';');
		if (headerRowIndex < 0) {
			return {
				adapterId: 'dkb_creditcard',
				rows: [],
				errors: [
					makeParseError(1, 'missing_header', 'Could not find DKB credit card Belegdatum header row')
				],
				skippedRows: 0
			};
		}

		const parsed = parseDelimitedCsv(csv, { delimiter: ';', headerRowIndex });
		const missingColumns = missingRequiredColumns(parsed.headers, requiredColumns);
		if (missingColumns.length > 0) {
			return {
				adapterId: 'dkb_creditcard',
				rows: [],
				errors: [
					makeParseError(
						headerRowIndex + 1,
						'missing_required_column',
						`Missing required columns: ${missingColumns.join(', ')}`
					)
				],
				skippedRows: parsed.records.length
			};
		}

		const rows: NormalizedTransaction[] = [];
		const errors: ParseError[] = [...parsed.errors];
		const dedupeOccurrences = new Map<string, number>();

		for (const record of parsed.records) {
			const bookingDate = parseGermanShortDate(record.values.Belegdatum ?? '');
			const valueDate = parseGermanShortDate(record.values.Wertstellung ?? '');
			const amountCents = parseEuroCents(record.values['Betrag (€)'] ?? '');
			const status = record.values.Status?.trim();

			if (!bookingDate) {
				errors.push(
					makeParseError(record.rowNumber, 'invalid_booking_date', 'Belegdatum must use DD.MM.YY')
				);
				continue;
			}

			if (!valueDate) {
				errors.push(
					makeParseError(record.rowNumber, 'invalid_value_date', 'Wertstellung must use DD.MM.YY')
				);
				continue;
			}

			if (amountCents === undefined) {
				errors.push(
					makeParseError(record.rowNumber, 'invalid_amount', 'Betrag (€) must be a decimal amount')
				);
				continue;
			}

			if (!status) {
				errors.push(makeParseError(record.rowNumber, 'invalid_status', 'Status is required'));
				continue;
			}

			const description = record.values.Beschreibung?.trim() || undefined;
			const rawType = record.values.Umsatztyp?.trim() || undefined;
			const foreignAmount = parseForeignAmount(record.values.Fremdwährungsbetrag);
			const baseDedupeKey = stableFingerprint([bookingDate, amountCents, description, rawType]);
			const occurrence = (dedupeOccurrences.get(baseDedupeKey) ?? 0) + 1;
			dedupeOccurrences.set(baseDedupeKey, occurrence);

			rows.push({
				bookingDate,
				valueDate,
				amountCents,
				currency: 'EUR',
				originalAmountCents: foreignAmount?.amountCents,
				originalCurrency: foreignAmount?.currency,
				payee: description,
				description,
				searchText: normalizeWhitespace(description, rawType),
				dedupeKey: `${baseDedupeKey}:${occurrence}`,
				source: {
					bankId: 'dkb_creditcard',
					rowNumber: record.rowNumber,
					rawType
				}
			});
		}

		return {
			adapterId: 'dkb_creditcard',
			rows,
			errors,
			skippedRows: parsed.records.length - rows.length
		};
	}
};

function parseForeignAmount(value: string | undefined):
	| { amountCents: number; currency: string | undefined }
	| undefined {
	const trimmed = value?.trim();
	if (!trimmed) return undefined;

	const match = /^(-?[\d.]+(?:,\d+)?|-?\d+(?:\.\d+)?)[\s\u00a0]*([^\d\s]+)?$/.exec(trimmed);
	if (!match) return undefined;

	const amountCents = parseEuroCents(match[1]);
	if (amountCents === undefined) return undefined;

	return { amountCents, currency: match[2] || undefined };
}
