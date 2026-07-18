import { beforeEach, describe, expect, it } from 'vitest';
import {
	applyMigrations,
	createTestDatabase,
	createTestDbClient
} from '../../../../../tests/db/test-database';
import type { DbClient } from '$lib/server/db-client';
import { confirmImport } from '$lib/server/imports/confirm';
import { previewImport } from '$lib/server/imports/preview';
import { sha256Hex } from '$lib/server/imports/shared';
import { n26Csv, n26UpdateCsv } from '$lib/server/imports/preview.test';
import { POST } from './+server';

let db: DbClient;
beforeEach(async () => {
	const sqlite = await createTestDatabase();
	await applyMigrations(sqlite);
	db = createTestDbClient(sqlite);
});

describe('/api/imports/confirm', () => {
	it('creates a new account from a validated assignment', async () => {
		const csv = dkbCsv();
		const assignments = [
			{
				sourceAccountKey: null,
				newAccount: { name: 'Imported DKB', institution: 'DKB' },
				balanceMode: 'complete_history' as const
			}
		];
		const checked = await previewImport(db, { adapterId: 'dkb_girocard', csv, assignments });
		const data = form(csv, await sha256Hex(csv), checked.configurationHash!);
		data.set('assignments', JSON.stringify(assignments));
		const response = await POST(event(data));
		expect(response.status).toBe(201);
		await expect(response.json()).resolves.toMatchObject({
			report: {
				importedCount: 1,
				accounts: [{ accountName: 'Imported DKB', createdAccount: true }]
			}
		});
	});

	it('returns a nullable reported balance for snapshot continuation', async () => {
		const csv = n26Csv().split('\n').slice(0, 3).join('\n');
		const initialAssignments = [
			{
				sourceAccountKey: 'Main',
				newAccount: { name: 'N26 Main', institution: 'N26' },
				balanceMode: 'complete_history' as const
			}
		];
		const initial = await previewImport(db, {
			adapterId: 'n26',
			csv,
			assignments: initialAssignments
		});
		await confirmImport(db, {
			adapterId: 'n26',
			csv,
			expectedHash: initial.fileHash,
			expectedConfigurationHash: initial.configurationHash!,
			assignments: initialAssignments
		});
		const updateCsv = n26UpdateCsv().split('\n').slice(0, 3).join('\n');
		const update = await previewImport(db, { adapterId: 'n26', csv: updateCsv });
		const data = form(updateCsv, update.fileHash, update.configurationHash!);
		data.set('adapterId', 'n26');
		data.set('assignments', JSON.stringify(update.accounts.map((group) => group.assignment)));

		const response = await POST(event(data));

		expect(response.status).toBe(201);
		await expect(response.json()).resolves.toMatchObject({
			report: {
				importedCount: 1,
				duplicateCount: 1,
				accounts: [
					{
						balanceMode: 'continue_from_snapshot',
						reportedBalanceCents: null
					}
				]
			}
		});
	});

	it('rejects a hash mismatch', async () => {
		const data = form(dkbCsv(), 'bad', 'configuration');
		data.set('assignments', '[]');
		const response = await POST(event(data));
		expect(response.status).toBe(400);
	});

	it.each([
		['null assignment', '[null]'],
		[
			'invalid reported balance',
			JSON.stringify([
				{
					sourceAccountKey: null,
					targetAccountId: 'account',
					balanceMode: 'reported',
					reportedBalanceCents: '100'
				}
			])
		]
	])('returns 400 for malformed assignments: %s', async (_label, assignments) => {
		const data = form(dkbCsv(), 'hash', 'configuration');
		data.set('assignments', assignments);
		const response = await POST(event(data));
		expect(response.status).toBe(400);
	});
});

function form(csv: string, expectedHash: string, expectedConfigurationHash: string): FormData {
	const data = new FormData();
	data.set('adapterId', 'dkb_girocard');
	data.set('expectedHash', expectedHash);
	data.set('expectedConfigurationHash', expectedConfigurationHash);
	data.set('file', new Blob([csv], { type: 'text/csv' }), 'bank.csv');
	return data;
}
function event(body: FormData) {
	return {
		platform: { env: { DB: db } },
		request: new Request('http://localhost/api/imports/confirm', { method: 'POST', body })
	} as Parameters<typeof POST>[0];
}
function dkbCsv(): string {
	return [
		'"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"',
		'"08.07.26";"08.07.26";"Gebucht";"Me";"Shop";"Groceries";"Ausgang";"DE";"12,34";"";"";"ref-shop"'
	].join('\n');
}
