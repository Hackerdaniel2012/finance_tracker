import { beforeEach, describe, expect, it } from 'vitest';
import {
	applyMigrations,
	createTestDatabase,
	createTestDbClient
} from '../../../../tests/db/test-database';
import { createAccount, createProfile } from '$lib/server/accounts/repository';
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

describe('/api/summary', () => {
	it('returns summary totals for a date range', async () => {
		await seedTransaction();

		const response = await GET(event('http://localhost/api/summary?from=2026-07-01&to=2026-07-31'));

		await expect(response.json()).resolves.toMatchObject({
			summary: {
				range: { from: '2026-07-01', to: '2026-07-31' },
				totals: {
					expenseCents: -1234,
					netCents: -1234,
					transactionCount: 1,
					unknownCount: 1
				}
			}
		});
	});

	it('filters summary totals by subaccount', async () => {
		const account = await seedN26Transactions();

		const allResponse = await GET(
			event(`http://localhost/api/summary?from=2026-07-01&to=2026-07-31&accountId=${account.id}`)
		);
		await expect(allResponse.json()).resolves.toMatchObject({
			summary: {
				totals: {
					incomeCents: 250000,
					expenseCents: -1634,
					netCents: 248366,
					transactionCount: 3
				}
			}
		});

		const mainResponse = await GET(
			event(
				`http://localhost/api/summary?from=2026-07-01&to=2026-07-31&accountId=${account.id}&subaccount=Hauptkonto`
			)
		);
		await expect(mainResponse.json()).resolves.toMatchObject({
			summary: {
				totals: {
					incomeCents: 0,
					expenseCents: -1634,
					netCents: -1634,
					transactionCount: 2
				}
			}
		});
	});

	it('returns expense totals grouped by month and category', async () => {
		const account = await createAccount(db, { name: 'Monthly account' });
		const profile = await createProfile(db, {
			accountId: account.id,
			bankId: 'n26',
			label: 'Monthly CSV'
		});
		const csv = n26Csv([
			'2026-05-08,,Market,DE,"Debit Transfer",Groceries,"Hauptkonto",-10.00,,,',
			'2026-06-08,,Market,DE,"Debit Transfer",Groceries,"Hauptkonto",-20.00,,,',
			'2026-06-09,,Cafe,DE,"Debit Transfer",Coffee,"Hauptkonto",-4.00,,,',
			'2026-07-08,,Market,DE,"Debit Transfer",Groceries,"Hauptkonto",-30.00,,,',
			'2026-07-09,,Cafe,DE,"Debit Transfer",Coffee,"Hauptkonto",-5.00,,,',
			'2026-07-10,,Refund,DE,"Credit Transfer",Groceries,"Hauptkonto",5.00,,,'
		]);
		await confirmImport(db, {
			profileId: profile.id,
			csv,
			expectedHash: await sha256Hex(csv)
		});
		await db
			.prepare(
				"UPDATE transactions SET category_id = 'cat-groceries' WHERE account_id = ? AND payee = 'Market'"
			)
			.bind(account.id)
			.run();

		const response = await GET(
			event(
				`http://localhost/api/summary?from=2026-05-01&to=2026-07-31&accountId=${account.id}&subaccount=Hauptkonto`
			)
		);

		await expect(response.json()).resolves.toMatchObject({
			summary: {
				byMonthCategory: [
					{ month: '2026-05', categoryName: 'Groceries', expenseCents: 1000 },
					{ month: '2026-06', categoryName: 'Groceries', expenseCents: 2000 },
					{ month: '2026-06', categoryName: 'Unknown', expenseCents: 400 },
					{ month: '2026-07', categoryName: 'Groceries', expenseCents: 3000 },
					{ month: '2026-07', categoryName: 'Unknown', expenseCents: 500 }
				]
			}
		});
	});

	it('returns validation errors for invalid ranges', async () => {
		const response = await GET(event('http://localhost/api/summary?from=2026-08-01&to=2026-07-01'));

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({
			error: 'from must be before or equal to to'
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

async function seedTransaction() {
	const account = await createAccount(db, { name: 'DKB Giro' });
	const profile = await createProfile(db, {
		accountId: account.id,
		bankId: 'dkb',
		label: 'DKB CSV'
	});
	const csv = dkbCsv([
		'"08.07.26";"08.07.26";"Gebucht";"Me";"Shop";"Groceries";"Ausgang";"DE";"12,34";"";"";"ref-shop"'
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
