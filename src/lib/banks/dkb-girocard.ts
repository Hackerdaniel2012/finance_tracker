import { findHeaderRow, missingRequiredColumns, parseDelimitedCsv, splitLines } from './csv';
import {
	makeParseError,
	normalizeWhitespace,
	parseGermanShortDate,
	parseEuroCents,
	stableFingerprint
} from './normalize';
import type { BankAdapter, NormalizedTransaction, ParseError } from './types';

const requiredColumns = [
	'Buchungsdatum',
	'Wertstellung',
	'Status',
	'Zahlungspflichtige*r',
	'Zahlungsempfänger*in',
	'Verwendungszweck',
	'Umsatztyp',
	'Betrag (€)',
	'Kundenreferenz'
];

export const dkbAdapter: BankAdapter = {
	id: 'dkb_girocard',
	label: 'DKB Giro Card',
	status: 'enabled',
	requiredColumns,
	parse(csv) {
		const headerRowIndex = findHeaderRow(csv, 'Buchungsdatum', ';');
		if (headerRowIndex < 0) {
			return {
				adapterId: 'dkb_girocard',
				rows: [],
				errors: [
					makeParseError(1, 'missing_header', 'Could not find DKB Buchungsdatum header row')
				],
				skippedRows: 0
			};
		}

		const parsed = parseDelimitedCsv(csv, { delimiter: ';', headerRowIndex });
		const metadata = parseDkbMetadata(csv, headerRowIndex);
		const sourceAccountKey = metadata.Girokonto?.trim() || undefined;
		const missingColumns = missingRequiredColumns(parsed.headers, requiredColumns);
		if (missingColumns.length > 0) {
			return {
				adapterId: 'dkb_girocard',
				rows: [],
				errors: [
					makeParseError(
						headerRowIndex + 1,
						'missing_required_column',
						`Missing required columns: ${missingColumns.join(', ')}`
					)
				],
				skippedRows: parsed.records.length,
				metadata
			};
		}

		const rows: NormalizedTransaction[] = [];
		const errors: ParseError[] = [...parsed.errors];

		for (const record of parsed.records) {
			const bookingDate = parseGermanShortDate(record.values.Buchungsdatum ?? '');
			const valueDate = parseGermanShortDate(record.values.Wertstellung ?? '');
			const parsedAmount = parseEuroCents(record.values['Betrag (€)'] ?? '');

			if (!bookingDate) {
				errors.push(
					makeParseError(
						record.rowNumber,
						'invalid_booking_date',
						'Buchungsdatum must use DD.MM.YY'
					)
				);
				continue;
			}

			if (parsedAmount === undefined) {
				errors.push(
					makeParseError(record.rowNumber, 'invalid_amount', 'Betrag (€) must be a decimal amount')
				);
				continue;
			}

			const amountCents = applyDirection(parsedAmount, record.values.Umsatztyp);
			if (amountCents === undefined) {
				errors.push(
					makeParseError(
						record.rowNumber,
						'invalid_direction',
						'Umsatztyp must be Ausgang or Eingang'
					)
				);
				continue;
			}

			const payer = record.values['Zahlungspflichtige*r'];
			const recipient = record.values['Zahlungsempfänger*in'];
			const payee = amountCents < 0 ? recipient || payer : payer || recipient;
			const description = normalizeWhitespace(
				record.values.Verwendungszweck,
				record.values.Umsatztyp,
				record.values.IBAN
			);
			const searchText = normalizeWhitespace(payee, description);
			const externalId = record.values.Kundenreferenz || undefined;

			rows.push({
				bookingDate,
				valueDate,
				amountCents,
				currency: 'EUR',
				payee: payee || undefined,
				description,
				searchText,
				dedupeKey: externalId
					? buildDkbReferenceKey(externalId, bookingDate, valueDate, amountCents)
					: stableFingerprint([
							bookingDate,
							valueDate,
							amountCents,
							payer,
							recipient,
							record.values.Verwendungszweck,
							record.values.IBAN
						]),
				source: {
					bankId: 'dkb_girocard',
					rowNumber: record.rowNumber,
					rawType: record.values.Umsatztyp,
					externalId,
					sourceAccountKey,
					sourceAccountLabel: sourceAccountKey ? 'Girokonto' : undefined
				}
			});
		}

		return {
			adapterId: 'dkb_girocard',
			rows,
			errors,
			skippedRows: parsed.records.length - rows.length,
			metadata
		};
	}
};

function buildDkbReferenceKey(
	externalId: string,
	bookingDate: string,
	valueDate: string | undefined,
	amountCents: number
): string {
	return `dkb_ref:${externalId}|${bookingDate}|${valueDate ?? ''}|${amountCents}`;
}

function applyDirection(amountCents: number, direction: string): number | undefined {
	if (direction === 'Ausgang') {
		return -Math.abs(amountCents);
	}

	if (direction === 'Eingang') {
		return Math.abs(amountCents);
	}

	return undefined;
}

function parseDkbMetadata(csv: string, headerRowIndex: number): Record<string, string> {
	const metadata: Record<string, string> = {};

	for (const line of splitLines(csv).slice(0, headerRowIndex)) {
		const [key, value] = line
			.replace(/^"|"$/g, '')
			.split('";"')
			.map((part) => part.trim());

		if (key && value) {
			metadata[key.replace(/:$/, '')] = value;
		}
	}

	return metadata;
}
