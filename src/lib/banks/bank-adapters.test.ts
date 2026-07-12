import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	dkbAdapter,
	dkbCreditcardAdapter,
	getBankAdapter,
	n26Adapter,
	tradeRepublicAdapter
} from './index';

async function readFixture(filename: string): Promise<string> {
	return readFile(resolve('tests/fixtures', filename), 'utf8');
}

describe('bank adapters', () => {
	it('lists enabled adapters by bank id', () => {
		expect(getBankAdapter('n26')).toBe(n26Adapter);
		expect(getBankAdapter('trade_republic')).toBe(tradeRepublicAdapter);
		expect(getBankAdapter('dkb_girocard')).toBe(dkbAdapter);
		expect(getBankAdapter('dkb_creditcard')).toBe(dkbCreditcardAdapter);
	});
});

describe('N26 adapter', () => {
	it('parses the fixture into normalized EUR transactions', async () => {
		const result = n26Adapter.parse(await readFixture('n26-basic.csv'));

		expect(result.errors).toEqual([]);
		expect(result.skippedRows).toBe(0);
		expect(result.rows).toHaveLength(4);
		expect(result.rows[0]).toMatchObject({
			bookingDate: '2026-07-01',
			amountCents: 250000,
			currency: 'EUR',
			payee: 'Example Employer',
			source: { bankId: 'n26', rowNumber: 2, rawType: 'Credit Transfer' }
		});
		expect(result.rows[0]?.searchText).toContain('Synthetic salary');
		expect(result.rows[0]?.dedupeKey).toMatch(/^fp_[0-9a-f]{8}:1$/);
	});

	it('keeps repeated N26 rows with identical visible fields as separate transactions', async () => {
		const result = n26Adapter.parse(await readFixture('n26-basic.csv'));
		const dedupeKeys = result.rows.map((row) => row.dedupeKey);
		const balanceCents = result.rows.reduce((sum, row) => sum + row.amountCents, 0);

		expect(result.errors).toEqual([]);
		expect(result.rows).toHaveLength(4);
		expect(new Set(dedupeKeys)).toHaveLength(result.rows.length);
		expect(balanceCents).toBe(243350);
	});

	it('adds occurrence numbers to identical N26 fallback fingerprints', () => {
		const csv = [
			'"Booking Date","Value Date","Partner Name","Partner Iban",Type,"Payment Reference","Account Name","Amount (EUR)","Original Amount","Original Currency","Exchange Rate"',
			'2026-07-08,2026-07-08,N26,,Fee,"ATM Withdrawal Fee",Main,-2.00,,,',
			'2026-07-08,2026-07-08,N26,,Fee,"ATM Withdrawal Fee",Main,-2.00,,,'
		].join('\n');

		const result = n26Adapter.parse(csv);

		expect(result.rows).toHaveLength(2);
		expect(result.rows[0]?.dedupeKey).toMatch(/^fp_[0-9a-f]{8}:1$/);
		expect(result.rows[1]?.dedupeKey).toMatch(/^fp_[0-9a-f]{8}:2$/);
		expect(result.rows[0]?.dedupeKey).not.toBe(result.rows[1]?.dedupeKey);
	});

	it('reports malformed dates and invalid amounts without throwing', () => {
		const csv = [
			'"Booking Date","Value Date","Partner Name","Partner Iban",Type,"Payment Reference","Account Name","Amount (EUR)","Original Amount","Original Currency","Exchange Rate"',
			'not-a-date,,Shop,DE,"Debit Transfer",Coffee,Main,-1.23,,,',
			'2026-02-31,,Shop,DE,"Debit Transfer",Coffee,Main,-1.23,,,',
			'2026-07-08,,Shop,DE,"Debit Transfer",Coffee,Main,not-money,,,'
		].join('\n');

		const result = n26Adapter.parse(csv);

		expect(result.rows).toEqual([]);
		expect(result.skippedRows).toBe(3);
		expect(result.errors.map((error) => error.code)).toEqual([
			'invalid_booking_date',
			'invalid_booking_date',
			'invalid_amount'
		]);
	});

	it('fails validation when required columns are missing', () => {
		const result = n26Adapter.parse('"Booking Date","Amount (EUR)"\n2026-07-08,1.00');

		expect(result.rows).toEqual([]);
		expect(result.errors[0]).toMatchObject({ rowNumber: 1, code: 'missing_required_column' });
	});

	it('stores the N26 Account Name as source.subaccount', () => {
		const csv = [
			'"Booking Date","Value Date","Partner Name","Partner Iban",Type,"Payment Reference","Account Name","Amount (EUR)","Original Amount","Original Currency","Exchange Rate"',
			'2026-07-08,,Shop,DE,"Debit Transfer",Coffee,"Hauptkonto",-1.23,,,',
			'2026-07-08,,Hauptkonto,,"Credit Transfer",Salary,"20k in 2023",2500.00,,,'
		].join('\n');

		const result = n26Adapter.parse(csv);

		expect(result.rows).toHaveLength(2);
		expect(result.rows[0]?.source).toMatchObject({
			bankId: 'n26',
			subaccount: 'Hauptkonto'
		});
		expect(result.rows[1]?.source).toMatchObject({
			bankId: 'n26',
			subaccount: '20k in 2023'
		});
	});
});

describe('Trade Republic adapter', () => {
	it('parses the fixture and uses transaction_id as the dedupe key', async () => {
		const result = tradeRepublicAdapter.parse(await readFixture('trade-republic-basic.csv'));

		expect(result.errors).toEqual([]);
		expect(result.skippedRows).toBeGreaterThan(0);
		expect(result.rows).toHaveLength(2);
		expect(result.rows[0]).toMatchObject({
			bookingDate: '2026-07-01',
			amountCents: 100000,
			currency: 'EUR',
			payee: 'Example User',
			dedupeKey: 'synthetic-tr-1',
			source: {
				bankId: 'trade_republic',
				rowNumber: 2,
				rawType: 'CUSTOMER_INBOUND',
				externalId: 'synthetic-tr-1'
			}
		});
		expect(result.rows[1]).toMatchObject({
			bookingDate: '2026-07-02',
			amountCents: -10000,
			payee: 'Example Fund'
		});
	});

	it('falls back to a stable fingerprint when transaction_id is empty', () => {
		const csv = [
			'"datetime","date","account_type","category","type","asset_class","name","symbol","shares","price","amount","fee","tax","currency","original_amount","original_currency","fx_rate","description","transaction_id","counterparty_name","counterparty_iban","payment_reference","mcc_code"',
			'"2026-07-08T00:00:00.000Z","2026-07-08","DEFAULT","CASH","CUSTOMER_INBOUND","","Payee","","","","10.00","","","EUR","","","","Note","","Payee","DE","",""'
		].join('\n');

		const result = tradeRepublicAdapter.parse(csv);

		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]?.dedupeKey).toMatch(/^fp_[0-9a-f]{8}$/);
	});

	it('reports invalid amount and unsupported currency rows', () => {
		const csv = [
			'"datetime","date","account_type","category","type","asset_class","name","symbol","shares","price","amount","fee","tax","currency","original_amount","original_currency","fx_rate","description","transaction_id","counterparty_name","counterparty_iban","payment_reference","mcc_code"',
			'"2026-07-08T00:00:00.000Z","2026-07-08","DEFAULT","CASH","CUSTOMER_INBOUND","","Payee","","","","nope","","","EUR","","","","Note","id-1","Payee","DE","",""',
			'"2026-07-08T00:00:00.000Z","2026-07-08","DEFAULT","CASH","CUSTOMER_INBOUND","","Payee","","","","10.00","","","USD","","","","Note","id-2","Payee","DE","",""'
		].join('\n');

		const result = tradeRepublicAdapter.parse(csv);

		expect(result.rows).toEqual([]);
		expect(result.errors.map((error) => error.code)).toEqual([
			'invalid_amount',
			'unsupported_currency'
		]);
	});
});

describe('DKB adapter', () => {
	it('parses Girokonto metadata preamble and semicolon quoted rows', async () => {
		const result = dkbAdapter.parse(await readFixture('dkb-giro-basic.csv'));

		expect(result.errors).toEqual([]);
		expect(result.skippedRows).toBe(0);
		expect(result.metadata).toMatchObject({
			Girokonto: 'DE00000000000000000000',
			Zeitraum: '01.07.2026 - 31.07.2026'
		});
		expect(result.rows).toHaveLength(3);
		expect(result.rows[0]).toMatchObject({
			bookingDate: '2026-07-01',
			valueDate: '2026-07-01',
			amountCents: -4250,
			currency: 'EUR',
			payee: 'Example Market',
			dedupeKey: 'synthetic-dkb-1',
			source: {
				bankId: 'dkb_girocard',
				rowNumber: 5,
				rawType: 'Ausgang',
				externalId: 'synthetic-dkb-1'
			}
		});
	});

	it('uses Eingang and Ausgang direction values for amount signs', () => {
		const csv = [
			'"Girokonto";"DE00000000000000000000"',
			'""',
			'"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"',
			'"08.07.26";"08.07.26";"Gebucht";"Employer";"Me";"Salary";"Eingang";"DE";"123,45";"";"";"ref-in"',
			'"08.07.26";"08.07.26";"Gebucht";"Me";"Shop";"Groceries";"Ausgang";"DE";"123,45";"";"";"ref-out"'
		].join('\n');

		const result = dkbAdapter.parse(csv);

		expect(result.errors).toEqual([]);
		expect(result.rows.map((row) => row.amountCents)).toEqual([12345, -12345]);
		expect(result.rows.map((row) => row.payee)).toEqual(['Employer', 'Shop']);
	});

	it('falls back to a fingerprint when Kundenreferenz is empty', () => {
		const csv = [
			'"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"',
			'"08.07.26";"08.07.26";"Gebucht";"Me";"Shop";"Groceries";"Ausgang";"DE";"-12,34";"";"";""'
		].join('\n');

		const result = dkbAdapter.parse(csv);

		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]?.dedupeKey).toMatch(/^fp_[0-9a-f]{8}$/);
	});

	it('reports malformed dates, invalid amounts, and invalid directions', () => {
		const csv = [
			'"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"',
			'"bad";"08.07.26";"Gebucht";"Me";"Shop";"Groceries";"Ausgang";"DE";"-12,34";"";"";"1"',
			'"31.02.26";"08.07.26";"Gebucht";"Me";"Shop";"Groceries";"Ausgang";"DE";"-12,34";"";"";"4"',
			'"08.07.26";"08.07.26";"Gebucht";"Me";"Shop";"Groceries";"Ausgang";"DE";"wat";"";"";"2"',
			'"08.07.26";"08.07.26";"Gebucht";"Me";"Shop";"Groceries";"Neutral";"DE";"12,34";"";"";"3"'
		].join('\n');

		const result = dkbAdapter.parse(csv);

		expect(result.rows).toEqual([]);
		expect(result.errors.map((error) => error.code)).toEqual([
			'invalid_booking_date',
			'invalid_booking_date',
			'invalid_amount',
			'invalid_direction'
		]);
	});
});

describe('DKB credit card adapter', () => {
	it('parses the credit card fixture after its preamble', async () => {
		const result = dkbCreditcardAdapter.parse(await readFixture('dkb-credit-card-basic.csv'));

		expect(result.errors).toEqual([]);
		expect(result.skippedRows).toBe(0);
		expect(result.rows).toHaveLength(2);
		expect(result.rows[0]).toMatchObject({
			bookingDate: '2026-07-01',
			valueDate: '2026-07-01',
			amountCents: 10000,
			payee: 'Synthetic deposit',
			description: 'Synthetic deposit',
			source: { bankId: 'dkb_creditcard', rowNumber: 6, rawType: 'Einzahlung' }
		});
		expect(result.rows[1]).toMatchObject({
			amountCents: -2000,
			originalAmountCents: -2200,
			originalCurrency: 'USD',
			payee: 'Example Software'
		});
		expect(result.rows[1]?.dedupeKey).toMatch(/^fp_[0-9a-f]{8}$/);
	});

	it('requires the credit card headers and validates dates, amounts, and status', () => {
		const csv = [
			'"Belegdatum";"Wertstellung";"Status";"Beschreibung";"Umsatztyp";"Betrag (€)";"Fremdwährungsbetrag"',
			'"bad";"09.07.26";"Gebucht";"Shop";"Onlinezahlung";"-1,00";""',
			'"09.07.26";"bad";"Gebucht";"Shop";"Onlinezahlung";"-1,00";""',
			'"09.07.26";"09.07.26";"";"Shop";"Onlinezahlung";"-1,00";""',
			'"09.07.26";"09.07.26";"Gebucht";"Shop";"Onlinezahlung";"bad";""'
		].join('\n');

		const result = dkbCreditcardAdapter.parse(csv);

		expect(result.rows).toEqual([]);
		expect(result.errors.map((error) => error.code)).toEqual([
			'invalid_booking_date',
			'invalid_value_date',
			'invalid_status',
			'invalid_amount'
		]);
	});
});
