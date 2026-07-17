import { beforeEach, describe, expect, it } from 'vitest';
import {
	applyMigrations,
	createTestDatabase,
	createTestDbClient,
	firstValue
} from '../../../../tests/db/test-database';
import type { DbClient } from '../db-client';
import { importIntoExistingAccount } from '../imports/test-support';
import { previewImport } from '../imports/preview';
import { deleteImportRun } from '../imports/repository';
import { sha256Hex } from '../imports/shared';
import { createAccount } from './repository';
import { listCalculatedAccountBalances } from './balance';

let db: DbClient;
let sqlite: Awaited<ReturnType<typeof createTestDatabase>>;

beforeEach(async () => {
	sqlite = await createTestDatabase();
	await applyMigrations(sqlite);
	db = createTestDbClient(sqlite);
});

describe('import-anchored account balances', () => {
	it('uses the first import as anchor and counts later same-day rows exactly once', async () => {
		const account = await createAccount(db, { name: 'Checking' });
		const firstCsv = dkbCsv([
			'"10.07.26";"10.07.26";"Gebucht";"Me";"First";"Initial";"Ausgang";"DE";"5,00";"";"";"first"'
		]);
		const first = await confirm(account.id, firstCsv, 10000);
		expect(await balance(account.id)).toBe(10000);

		const secondCsv = dkbCsv([
			'"10.07.26";"10.07.26";"Gebucht";"Me";"Second";"Later same day";"Ausgang";"DE";"2,00";"";"";"second"'
		]);
		const preview = await previewExisting(account.id, secondCsv, 9800);
		expect(preview.accounts[0]).toMatchObject({
			calculatedBalanceCents: 9800,
			differenceCents: 0,
			balanceMatches: true
		});
		const second = await confirm(account.id, secondCsv, 9800);
		expect(await balance(account.id)).toBe(9800);

		await expect(deleteImportRun(db, first.runId)).rejects.toThrow(
			'Newer imports must be deleted first'
		);
		await deleteImportRun(db, second.runId);
		expect(await balance(account.id)).toBe(10000);
		await deleteImportRun(db, first.runId);
		expect(await balance(account.id)).toBeNull();
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM account_balance_snapshots')).toBe(0);
	});

	it('ignores newly imported history before the anchor and rejects balance drift atomically', async () => {
		const account = await createAccount(db, { name: 'Checking' });
		const firstCsv = dkbCsv([
			'"10.07.26";"10.07.26";"Gebucht";"Me";"First";"Initial";"Ausgang";"DE";"5,00";"";"";"first"'
		]);
		await confirm(account.id, firstCsv, 10000);

		const historicalCsv = dkbCsv([
			'"09.07.26";"09.07.26";"Gebucht";"Me";"Old";"History";"Ausgang";"DE";"3,00";"";"";"old"'
		]);
		const preview = await previewExisting(account.id, historicalCsv, 10000);
		expect(preview.accounts[0].calculatedBalanceCents).toBe(10000);
		await confirm(account.id, historicalCsv, 10000);
		expect(await balance(account.id)).toBe(10000);

		const newCsv = dkbCsv([
			'"11.07.26";"11.07.26";"Gebucht";"Me";"New";"New";"Ausgang";"DE";"1,00";"";"";"new"'
		]);
		const batchCount = firstValue<number>(sqlite, 'SELECT COUNT(*) FROM import_batches');
		await expect(confirm(account.id, newCsv, 9999)).rejects.toThrow(
			'Reported balance does not match the calculated balance'
		);
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM import_batches')).toBe(batchCount);
		expect(await balance(account.id)).toBe(10000);
	});

	it('does not count same-day candidates after a manual snapshot', async () => {
		const account = await createAccount(db, { name: 'Manual anchor' });
		await db.prepare(
			`INSERT INTO account_balance_snapshots (id, account_id, snapshot_date, balance_cents, source)
			VALUES ('manual', ?, '2026-07-10', 10000, 'manual')`
		).bind(account.id).run();
		const csv = dkbCsv([
			'"10.07.26";"10.07.26";"Gebucht";"Me";"Same day";"Same day";"Ausgang";"DE";"2,00";"";"";"manual-same-day"'
		]);
		const preview = await previewExisting(account.id, csv, 10000);
		expect(preview.accounts[0]).toMatchObject({ calculatedBalanceCents: 10000, differenceCents: 0 });
	});
});

async function confirm(accountId: string, csv: string, reportedBalanceCents: number) {
	return importIntoExistingAccount(db, {
		accountId,
		adapterId: 'dkb_girocard',
		csv,
		expectedHash: await sha256Hex(csv),
		reportedBalanceCents
	});
}

async function previewExisting(accountId: string, csv: string, reportedBalanceCents: number) {
	const discovered = await previewImport(db, { adapterId: 'dkb_girocard', csv });
	return previewImport(db, {
		adapterId: 'dkb_girocard',
		csv,
		assignments: [{
			sourceAccountKey: discovered.accounts[0].sourceAccountKey,
			targetAccountId: accountId,
			balanceMode: 'reported',
			reportedBalanceCents
		}]
	});
}

async function balance(accountId: string) {
	return (await listCalculatedAccountBalances(db, '2026-07-31', accountId))[0]?.balanceCents;
}

function dkbCsv(rows: string[]): string {
	return [
		'"Buchungsdatum";"Wertstellung";"Status";"Zahlungspflichtige*r";"Zahlungsempfänger*in";"Verwendungszweck";"Umsatztyp";"IBAN";"Betrag (€)";"Gläubiger-ID";"Mandatsreferenz";"Kundenreferenz"',
		...rows
	].join('\n');
}
