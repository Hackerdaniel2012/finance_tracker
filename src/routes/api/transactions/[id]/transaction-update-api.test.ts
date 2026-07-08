import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
	applySql,
	createTestDatabase,
	createTestDbClient
} from '../../../../../tests/db/test-database';
import { createAccount, createProfile } from '$lib/server/accounts/repository';
import type { DbClient } from '$lib/server/db-client';
import { confirmImport } from '$lib/server/imports/confirm';
import { sha256Hex } from '$lib/server/imports/shared';
import { listUnknownTransactions } from '$lib/server/transactions/repository';
import { PATCH } from './+server';

let db: DbClient;

beforeEach(async () => {
	const sqlite = await createTestDatabase();
	applySql(sqlite, await readFile(resolve('migrations/0001_initial_schema.sql'), 'utf8'));
	applySql(sqlite, await readFile(resolve('migrations/0002_seed_default_categories.sql'), 'utf8'));
	db = createTestDbClient(sqlite);
});

describe('/api/transactions/:id', () => {
	it('updates transaction category, note, tags, and creates a rule', async () => {
		const transactionId = await seedUnknownTransaction();

		const response = await PATCH(
			event(transactionId, {
				categoryId: 'cat-leisure',
				note: 'Reviewed',
				tagNames: ['Weekend'],
				createRule: true,
				ruleName: 'Cafe rule'
			})
		);

		await expect(response.json()).resolves.toMatchObject({
			transaction: {
				id: transactionId,
				categoryId: 'cat-leisure',
				categoryName: 'Leisure',
				note: 'Reviewed',
				classificationStatus: 'manual',
				reviewFlag: null,
				tags: [{ name: 'Weekend' }]
			}
		});
	});

	it('returns validation and not found errors', async () => {
		const malformed = await PATCH(eventWithMalformedJson('txn-1'));
		expect(malformed.status).toBe(400);
		await expect(malformed.json()).resolves.toEqual({ error: 'Request body must be valid JSON' });

		const invalid = await PATCH(event('txn-1', { tagNames: 'bad' }));
		expect(invalid.status).toBe(400);
		await expect(invalid.json()).resolves.toEqual({
			error: 'tagNames must be an array of strings'
		});

		const missing = await PATCH(event('missing', { note: 'Nope' }));
		expect(missing.status).toBe(404);
		await expect(missing.json()).resolves.toEqual({ error: 'Transaction not found' });
	});
});

function event(id: string, body: unknown) {
	return {
		params: { id },
		platform: { env: { DB: db } },
		request: {
			json: async () => body
		}
	} as Parameters<typeof PATCH>[0];
}

function eventWithMalformedJson(id: string) {
	return {
		params: { id },
		platform: { env: { DB: db } },
		request: {
			json: async () => {
				throw new SyntaxError('Unexpected token');
			}
		}
	} as unknown as Parameters<typeof PATCH>[0];
}

async function seedUnknownTransaction(): Promise<string> {
	const account = await createAccount(db, { name: 'DKB Giro' });
	const profile = await createProfile(db, {
		accountId: account.id,
		bankId: 'dkb',
		label: 'DKB CSV'
	});
	const csv = dkbCsv([
		'"09.07.26";"09.07.26";"Gebucht";"Me";"Cafe";"Coffee";"Ausgang";"DE";"4,00";"";"";"ref-cafe"'
	]);

	await confirmImport(db, {
		profileId: profile.id,
		csv,
		expectedHash: await sha256Hex(csv)
	});

	const unknown = await listUnknownTransactions(db, {
		sort: 'booking_date',
		direction: 'desc',
		limit: 10,
		offset: 0
	});
	return unknown.transactions[0]?.id ?? '';
}

function dkbCsv(rows: string[]): string {
	return [
		'"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"',
		...rows
	].join('\n');
}
