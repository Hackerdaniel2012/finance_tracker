import { beforeEach, describe, expect, it } from 'vitest';
import {
	applyMigrations,
	createTestDatabase,
	createTestDbClient,
	firstValue
} from '../../../../tests/db/test-database';
import { createAccount, createProfile } from '../accounts/repository';
import { createCategoryRule } from '../categories/repository';
import type { DbClient } from '../db-client';
import { confirmImport } from '../imports/confirm';
import { sha256Hex } from '../imports/shared';
import { listTransactions, listUnknownTransactions, updateTransaction } from './repository';

let db: DbClient;
let sqlite: Awaited<ReturnType<typeof createTestDatabase>>;

beforeEach(async () => {
	sqlite = await createTestDatabase();
	await applyMigrations(sqlite);
	db = createTestDbClient(sqlite);
});

describe('transaction repository', () => {
	it('lists transactions with filters, sorting, pagination, and tags', async () => {
		await seedTransactions();
		const firstPage = await listTransactions(db, {
			search: 'coffee',
			sort: 'amount_cents',
			direction: 'asc',
			limit: 1,
			offset: 0
		});

		expect(firstPage.pagination).toEqual({ limit: 1, offset: 0, total: 1 });
		expect(firstPage.transactions[0]).toMatchObject({
			payee: 'Cafe',
			amountCents: -400,
			classificationStatus: 'unknown',
			reviewFlag: { reason: 'unknown_category', status: 'open' }
		});

		await updateTransaction(db, {
			id: firstPage.transactions[0]?.id ?? '',
			note: 'Morning coffee',
			tagNames: ['Work', 'Coffee']
		});
		const tagged = await listTransactions(db, {
			search: 'Morning',
			sort: 'booking_date',
			direction: 'desc',
			limit: 10,
			offset: 0
		});

		expect(tagged.transactions[0]?.tags.map((tag) => tag.name)).toEqual(['Coffee', 'Work']);
	});

	it('updates category, resolves review flags, and creates category rules from edits', async () => {
		await seedTransactions();
		const unknown = await listUnknownTransactions(db, {
			sort: 'booking_date',
			direction: 'desc',
			limit: 10,
			offset: 0
		});
		const transactionId =
			unknown.transactions.find((transaction) => transaction.payee === 'Cafe')?.id ?? '';

		const updated = await updateTransaction(db, {
			id: transactionId,
			categoryId: 'cat-leisure',
			note: 'Manual review done',
			tagNames: ['Fun'],
			createRule: true,
			ruleName: 'Cafe rule'
		});

		expect(updated).toMatchObject({
			id: transactionId,
			categoryId: 'cat-leisure',
			categoryName: 'Leisure',
			classificationStatus: 'manual',
			note: 'Manual review done',
			reviewFlag: null
		});
		expect(updated.tags.map((tag) => tag.name)).toEqual(['Fun']);
		expect(
			firstValue<string>(
				sqlite,
				"SELECT status FROM transaction_review_flags WHERE transaction_id = '" + transactionId + "'"
			)
		).toBe('resolved');
		expect(
			firstValue<string>(sqlite, "SELECT pattern FROM category_rules WHERE name = 'Cafe rule'")
		).toBe('Cafe');
	});

	it('filters transactions by direction, amount range, and tag', async () => {
		await seedTransactions();
		const all = await listTransactions(db, baseFilters());
		const cafe = all.transactions.find((transaction) => transaction.payee === 'Cafe');
		const salary = all.transactions.find((transaction) => transaction.payee === 'Employer');
		expect(cafe).toBeDefined();
		expect(salary).toBeDefined();

		const tagged = await updateTransaction(db, {
			id: cafe?.id ?? '',
			tagNames: ['Coffee']
		});
		await updateTransaction(db, {
			id: salary?.id ?? '',
			tagNames: ['Income']
		});

		await expect(
			listTransactions(db, {
				...baseFilters(),
				transactionDirection: 'income'
			})
		).resolves.toMatchObject({
			pagination: { total: 1 },
			transactions: [{ payee: 'Employer', amountCents: 250000 }]
		});

		await expect(
			listTransactions(db, {
				...baseFilters(),
				transactionDirection: 'expense',
				minAmountCents: -500,
				maxAmountCents: -100
			})
		).resolves.toMatchObject({
			pagination: { total: 1 },
			transactions: [{ payee: 'Cafe', amountCents: -400 }]
		});

		await expect(
			listTransactions(db, {
				...baseFilters(),
				tag: 'Coffee'
			})
		).resolves.toMatchObject({
			pagination: { total: 1 },
			transactions: [{ payee: 'Cafe' }]
		});

		await expect(
			listTransactions(db, {
				...baseFilters(),
				tag: tagged.tags[0]?.id
			})
		).resolves.toMatchObject({
			pagination: { total: 1 },
			transactions: [{ payee: 'Cafe' }]
		});
	});

	it('returns not found errors for missing transactions and categories', async () => {
		await seedTransactions();
		const [transaction] = (await listTransactions(db, baseFilters())).transactions;

		await expect(updateTransaction(db, { id: 'missing', note: 'Nope' })).rejects.toThrow(
			'Transaction not found'
		);
		await expect(
			updateTransaction(db, { id: transaction?.id ?? '', categoryId: 'missing' })
		).rejects.toThrow('Category not found');
	});
});

function baseFilters() {
	return {
		sort: 'booking_date' as const,
		direction: 'desc' as const,
		limit: 10,
		offset: 0
	};
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
