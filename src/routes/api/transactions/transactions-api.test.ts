import { beforeEach, describe, expect, it } from 'vitest';
import {
	applyMigrations,
	createTestDatabase,
	createTestDbClient
} from '../../../../tests/db/test-database';
import { createAccount, createProfile } from '$lib/server/accounts/repository';
import { createCategoryRule } from '$lib/server/categories/repository';
import type { DbClient } from '$lib/server/db-client';
import { confirmImport } from '$lib/server/imports/confirm';
import { sha256Hex } from '$lib/server/imports/shared';
import { GET } from './+server';

let db: DbClient;

beforeEach(async () => {
	const sqlite = await createTestDatabase();
	await applyMigrations(sqlite);
	db = createTestDbClient(sqlite);
});

describe('/api/transactions', () => {
	it('lists transactions with search and pagination metadata', async () => {
		await seedTransactions();

		const response = await GET(event('http://localhost/api/transactions?search=coffee&limit=1'));

		await expect(response.json()).resolves.toMatchObject({
			pagination: { limit: 1, offset: 0, total: 1 },
			transactions: [
				{
					payee: 'Cafe',
					amountCents: -400,
					classificationStatus: 'unknown'
				}
			]
		});
	});

	it('lists transactions with expanded backend filters', async () => {
		await seedTransactions();

		const incomeResponse = await GET(
			event('http://localhost/api/transactions?direction=income&minAmountCents=100000')
		);
		await expect(incomeResponse.json()).resolves.toMatchObject({
			pagination: { total: 1 },
			transactions: [{ payee: 'Employer', amountCents: 250000 }]
		});

		const expenseResponse = await GET(
			event(
				'http://localhost/api/transactions?transactionDirection=expense&minAmountCents=-500&maxAmountCents=-100'
			)
		);
		await expect(expenseResponse.json()).resolves.toMatchObject({
			pagination: { total: 1 },
			transactions: [{ payee: 'Cafe', amountCents: -400 }]
		});
	});

	it('filters transactions by account and subaccount', async () => {
		const account = await seedN26Transactions();

		const allResponse = await GET(
			event(`http://localhost/api/transactions?accountId=${account.id}`)
		);
		await expect(allResponse.json()).resolves.toMatchObject({
			pagination: { total: 3 }
		});

		const mainResponse = await GET(
			event(`http://localhost/api/transactions?accountId=${account.id}&subaccount=Hauptkonto`)
		);
		await expect(mainResponse.json()).resolves.toMatchObject({
			pagination: { total: 2 },
			transactions: [
				{ payee: 'Cafe', amountCents: -400 },
				{ payee: 'Shop', amountCents: -1234 }
			]
		});

		const savingsResponse = await GET(
			event(
				`http://localhost/api/transactions?accountId=${account.id}&subaccount=${encodeURIComponent('20k in 2023')}`
			)
		);
		await expect(savingsResponse.json()).resolves.toMatchObject({
			pagination: { total: 1 },
			transactions: [{ payee: 'Employer', amountCents: 250000 }]
		});
	});

	it('returns validation errors for invalid filters', async () => {
		const response = await GET(event('http://localhost/api/transactions?status=bad'));

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({
			error: 'status must be one of unknown, auto, manual, ignored'
		});
	});
});

async function seedN26Transactions() {
	const account = await createAccount(db, { name: 'N26' });
	const profile = await createProfile(db, {
		accountId: account.id,
		bankId: 'n26',
		label: 'N26 CSV'
	});
	const csv = n26Csv([
		'2026-07-08,,Shop,DE,"Debit Transfer",Groceries,"Hauptkonto",-12.34,,,',
		'2026-07-09,,Cafe,DE,"Debit Transfer",Coffee,"Hauptkonto",-4.00,,,',
		'2026-07-10,,Employer,DE,"Credit Transfer",Salary,"20k in 2023",2500.00,,,'
	]);

	await confirmImport(db, {
		profileId: profile.id,
		csv,
		expectedHash: await sha256Hex(csv)
	});

	return account;
}

function n26Csv(rows: string[]): string {
	return [
		'"Booking Date","Value Date","Partner Name","Partner Iban",Type,"Payment Reference","Account Name","Amount (EUR)","Original Amount","Original Currency","Exchange Rate"',
		...rows
	].join('\n');
}

function event(url: string) {
	return {
		platform: { env: { DB: db } },
		url: new URL(url)
	} as Parameters<typeof GET>[0];
}

async function seedTransactions() {
	const account = await createAccount(db, { name: 'DKB Giro' });
	const profile = await createProfile(db, {
		accountId: account.id,
		bankId: 'dkb',
		label: 'DKB CSV'
	});
	await createCategoryRule(db, {
		categoryId: 'cat-groceries',
		name: 'Shop rule',
		field: 'payee',
		operator: 'contains',
		pattern: 'Shop',
		priority: 10
	});
	const csv = dkbCsv([
		'"08.07.26";"08.07.26";"Gebucht";"Me";"Shop";"Groceries";"Ausgang";"DE";"12,34";"";"";"ref-shop"',
		'"09.07.26";"09.07.26";"Gebucht";"Me";"Cafe";"Coffee";"Ausgang";"DE";"4,00";"";"";"ref-cafe"',
		'"10.07.26";"10.07.26";"Gebucht";"Employer";"Me";"Salary";"Eingang";"DE";"2500,00";"";"";"ref-salary"'
	]);

	await confirmImport(db, {
		profileId: profile.id,
		csv,
		expectedHash: await sha256Hex(csv)
	});
}

function dkbCsv(rows: string[]): string {
	return [
		'"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"',
		...rows
	].join('\n');
}
