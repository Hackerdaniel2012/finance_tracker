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
	'date',
	'category',
	'type',
	'name',
	'amount',
	'currency',
	'transaction_id'
];

export const tradeRepublicAdapter: BankAdapter = {
	id: 'trade_republic',
	label: 'Trade Republic',
	status: 'enabled',
	requiredColumns,
	parse(csv) {
		const parsed = parseDelimitedCsv(csv, { delimiter: ',' });
		const missingColumns = missingRequiredColumns(parsed.headers, requiredColumns);
		if (missingColumns.length > 0) {
			return {
				adapterId: 'trade_republic',
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
			const bookingDate = parseIsoDate(record.values.date ?? '');
			const rawAmount = record.values.amount ?? '';
			const amountCents = parseEuroCents(rawAmount);

			if (!bookingDate) {
				errors.push(
					makeParseError(record.rowNumber, 'invalid_booking_date', 'date must use YYYY-MM-DD')
				);
				continue;
			}

			if (!rawAmount.trim()) {
				continue;
			}

			if (amountCents === undefined) {
				errors.push(
					makeParseError(record.rowNumber, 'invalid_amount', 'amount must be a decimal amount')
				);
				continue;
			}

			if (record.values.currency !== 'EUR') {
				errors.push(
					makeParseError(record.rowNumber, 'unsupported_currency', 'currency must be EUR')
				);
				continue;
			}

			const externalId = record.values.transaction_id || undefined;
			const payee = record.values.counterparty_name || record.values.name || undefined;
			const description = normalizeWhitespace(
				record.values.category,
				record.values.type,
				record.values.asset_class,
				record.values.name,
				record.values.description,
				record.values.payment_reference
			);
			const searchText = normalizeWhitespace(payee, description, record.values.symbol);

			rows.push({
				bookingDate,
				amountCents,
				currency: 'EUR',
				originalAmountCents: parseOptionalEuroCents(record.values.original_amount),
				originalCurrency: record.values.original_currency || undefined,
				exchangeRate: record.values.fx_rate || undefined,
				payee,
				description,
				searchText,
				dedupeKey:
					externalId ??
					stableFingerprint([
						bookingDate,
						amountCents,
						record.values.type,
						record.values.name,
						record.values.description,
						record.values.symbol
					]),
				source: {
					bankId: 'trade_republic',
					rowNumber: record.rowNumber,
					rawType: record.values.type,
					externalId
				}
			});
		}

		return {
			adapterId: 'trade_republic',
			rows,
			errors,
			skippedRows: parsed.records.length - rows.length
		};
	}
};
