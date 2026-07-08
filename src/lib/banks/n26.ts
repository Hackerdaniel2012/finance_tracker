import { missingRequiredColumns, parseDelimitedCsv } from './csv';
import {
	makeParseError,
	normalizeWhitespace,
	parseIsoDate,
	parseOptionalEuroCents,
	parseEuroCents,
	stableFingerprint
} from './normalize';
import type { BankAdapter, NormalizedTransaction, ParseError } from './types';

const requiredColumns = [
	'Booking Date',
	'Value Date',
	'Partner Name',
	'Type',
	'Payment Reference',
	'Account Name',
	'Amount (EUR)'
];

export const n26Adapter: BankAdapter = {
	id: 'n26',
	label: 'N26',
	status: 'enabled',
	requiredColumns,
	parse(csv) {
		const parsed = parseDelimitedCsv(csv, { delimiter: ',' });
		const missingColumns = missingRequiredColumns(parsed.headers, requiredColumns);
		if (missingColumns.length > 0) {
			return {
				adapterId: 'n26',
				rows: [],
				errors: [
					makeParseError(
						1,
						'missing_required_column',
						`Missing required columns: ${missingColumns.join(', ')}`
					)
				],
				skippedRows: parsed.records.length
			};
		}

		const rows: NormalizedTransaction[] = [];
		const errors: ParseError[] = [...parsed.errors];

		for (const record of parsed.records) {
			const bookingDate = parseIsoDate(record.values['Booking Date'] ?? '');
			const amountCents = parseEuroCents(record.values['Amount (EUR)'] ?? '');

			if (!bookingDate) {
				errors.push(
					makeParseError(
						record.rowNumber,
						'invalid_booking_date',
						'Booking Date must use YYYY-MM-DD'
					)
				);
				continue;
			}

			if (amountCents === undefined) {
				errors.push(
					makeParseError(
						record.rowNumber,
						'invalid_amount',
						'Amount (EUR) must be a decimal amount'
					)
				);
				continue;
			}

			const valueDate = parseIsoDate(record.values['Value Date'] ?? '');
			const payee = record.values['Partner Name'] || undefined;
			const description = normalizeWhitespace(
				record.values.Type,
				record.values['Payment Reference'],
				record.values['Account Name']
			);
			const searchText = normalizeWhitespace(payee, description);

			rows.push({
				bookingDate,
				valueDate,
				amountCents,
				currency: 'EUR',
				originalAmountCents: parseOptionalEuroCents(record.values['Original Amount']),
				originalCurrency: record.values['Original Currency'] || undefined,
				exchangeRate: record.values['Exchange Rate'] || undefined,
				payee,
				description,
				searchText,
				dedupeKey: stableFingerprint([
					bookingDate,
					valueDate,
					amountCents,
					payee,
					record.values.Type,
					record.values['Payment Reference'],
					record.values['Account Name']
				]),
				source: {
					bankId: 'n26',
					rowNumber: record.rowNumber,
					rawType: record.values.Type
				}
			});
		}

		return { adapterId: 'n26', rows, errors, skippedRows: parsed.records.length - rows.length };
	}
};
