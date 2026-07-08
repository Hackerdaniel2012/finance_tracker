import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	applySql,
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
	applySql(sqlite, await readFile(resolve('migrations/0001_initial_schema.sql'), 'utf8'));
	applySql(sqlite, await readFile(resolve('migrations/0002_seed_default_categories.sql'), 'utf8'));
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

	it('returns validation errors for invalid filters', async () => {
		const response = await GET(event('http://localhost/api/transactions?status=bad'));

		expect(response.status).toBe(400);
		await expect(response.json()).resolves.toEqual({
			error: 'status must be one of unknown, auto, manual, ignored'
		});
	});
});

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
		'"09.07.26";"09.07.26";"Gebucht";"Me";"Cafe";"Coffee";"Ausgang";"DE";"4,00";"";"";"ref-cafe"'
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
