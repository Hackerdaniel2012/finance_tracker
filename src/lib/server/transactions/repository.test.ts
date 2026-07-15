import { beforeEach, describe, expect, it } from 'vitest';
import {
	applyMigrations,
	createTestDatabase,
	createTestDbClient,
	firstValue
} from '../../../../tests/db/test-database';
import { createAccount } from '../accounts/repository';
import { createCategoryRule } from '../categories/repository';
import type { DbClient } from '../db-client';
import { confirmImport } from '../imports/confirm';
import { sha256Hex } from '../imports/shared';
import { reconcilePlans } from '../plans/matching';
import { createPlan, getPlan } from '../plans/repository';
import {
	listTransactions,
	listUnknownTransactions,
	previewCategoryRule,
	reclassifyTransactions,
	updateTransaction
} from './repository';

let db: DbClient;
let sqlite: Awaited<ReturnType<typeof createTestDatabase>>;

beforeEach(async () => {
	sqlite = await createTestDatabase();
	await applyMigrations(sqlite);
	db = createTestDbClient(sqlite);
});

describe('transaction repository', () => {
	it('exposes combined import metadata and rejects edits to combined records', async () => {
		const account = await createAccount(db, { name: 'DKB Giro' });
		const csv = dkbCsv([
			'"08.07.26";"08.07.26";"Gebucht";"Me";"Shop";"Old";"Ausgang";"DE";"12,34";"";"";"combined-source"'
		]);
		await confirmImport(db, {
			accountId: account.id,
			adapterId: 'dkb_girocard',
			csv,
			expectedHash: await sha256Hex(csv),
			combineBeforeDate: '2026-07-09'
		});

		const [combined] = (await listTransactions(db, baseFilters())).transactions;
		expect(combined).toMatchObject({
			kind: 'combined_import',
			subaccount: null,
			combineBeforeDate: '2026-07-09',
			bookingDate: '2026-07-08',
			classificationStatus: 'ignored'
		});
		await expect(updateTransaction(db, { id: combined?.id ?? '', note: 'change' })).rejects.toThrow(
			'Combined import transactions are read-only'
		);
	});

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

	it('previews and opt-in applies a rule only to existing unknown matches', async () => {
		await seedTransactions();
		const accountId = firstValue<string>(sqlite, 'SELECT id FROM accounts') ?? '';
		await db
			.prepare(
				`INSERT INTO transactions (id, account_id, dedupe_key, booking_date, amount_cents, payee, search_text)
			VALUES ('cafe-2', ?, 'cafe-2', '2026-07-08', -500, 'Cafe Central', 'Cafe Central')`
			)
			.bind(accountId)
			.run();
		await db
			.prepare(
				`INSERT INTO transaction_review_flags (id, transaction_id, reason)
			VALUES ('flag-cafe-2', 'cafe-2', 'unknown_category')`
			)
			.run();
		const preview = await previewCategoryRule(db, {
			field: 'payee',
			operator: 'contains',
			pattern: 'Cafe'
		});
		expect(preview.matchCount).toBe(2);
		const selected = (await listUnknownTransactions(db, baseFilters())).transactions.find(
			(item) => item.payee === 'Cafe'
		);
		const result = await updateTransaction(db, {
			id: selected?.id ?? '',
			categoryId: 'cat-leisure',
			createRule: true,
			applyRuleToExisting: true,
			ruleName: 'All cafes'
		});
		expect(result.bulkAppliedCount).toBe(1);
		expect(
			firstValue<string>(
				sqlite,
				"SELECT classification_status FROM transactions WHERE id = 'cafe-2'"
			)
		).toBe('auto');
		expect(
			firstValue<string>(
				sqlite,
				"SELECT status FROM transaction_review_flags WHERE id = 'flag-cafe-2'"
			)
		).toBe('resolved');
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

	it('does not persist category changes when rule validation fails', async () => {
		const account = await createAccount(db, { name: 'Checking' });
		const plan = await createPlan(db, {
			accountId: account.id,
			categoryId: 'cat-groceries',
			direction: 'expense',
			cadence: 'once',
			amountCents: 1000,
			nextDate: '2026-07-10'
		});
		await db
			.prepare(
				`INSERT INTO transactions (id,account_id,category_id,dedupe_key,booking_date,amount_cents,search_text)
				VALUES ('invalid-rule',?,'cat-groceries','invalid-rule','2026-07-10',-1000,'')`
			)
			.bind(account.id)
			.run();
		await reconcilePlans(db);

		await expect(
			updateTransaction(db, {
				id: 'invalid-rule',
				categoryId: 'cat-leisure',
				createRule: true
			})
		).rejects.toThrow('needs payee or search text');

		expect(
			firstValue<string>(sqlite, "SELECT category_id FROM transactions WHERE id = 'invalid-rule'")
		).toBe('cat-groceries');
		expect(
			firstValue<string>(
				sqlite,
				"SELECT plan_id FROM plan_transactions WHERE transaction_id = 'invalid-rule'"
			)
		).toBe(plan.id);
	});

	it('keeps the plan but moves an invalid category match to one unique new plan', async () => {
		const account = await createAccount(db, { name: 'Checking' });
		const oldPlan = await createPlan(db, {
			accountId: account.id,
			categoryId: 'cat-groceries',
			counterparty: 'Merchant',
			direction: 'expense',
			cadence: 'once',
			amountCents: 1000,
			nextDate: '2026-07-10'
		});
		const newPlan = await createPlan(db, {
			accountId: account.id,
			categoryId: 'cat-leisure',
			counterparty: 'Merchant',
			direction: 'expense',
			cadence: 'once',
			amountCents: 1000,
			nextDate: '2026-07-10'
		});
		await db
			.prepare(
				`INSERT INTO transactions (id,account_id,category_id,dedupe_key,booking_date,amount_cents,payee,search_text)
			 VALUES ('category-move',?,'cat-groceries','category-move','2026-07-10',-1000,'Merchant','Merchant')`
			)
			.bind(account.id)
			.run();
		await reconcilePlans(db);
		expect(
			firstValue<string>(
				sqlite,
				"SELECT plan_id FROM plan_transactions WHERE transaction_id='category-move'"
			)
		).toBe(oldPlan.id);

		await updateTransaction(db, { id: 'category-move', categoryId: 'cat-leisure' });

		expect(
			firstValue<string>(
				sqlite,
				"SELECT plan_id FROM plan_transactions WHERE transaction_id='category-move'"
			)
		).toBe(newPlan.id);
		expect(await getPlan(db, oldPlan.id)).toMatchObject({ status: 'active', transactionCount: 0 });
		expect(firstValue<number>(sqlite, 'SELECT COUNT(*) FROM plans')).toBe(2);
	});

	it('restores a liability when a manual category makes its payment ineligible', async () => {
		const account = await createAccount(db, { name: 'Checking' });
		const plan = await createPlan(db, {
			accountId: account.id,
			counterparty: 'Loan Bank',
			direction: 'expense',
			cadence: 'monthly',
			amountCents: 10000,
			nextDate: '2026-07-10',
			liability: {
				name: 'Loan',
				amountCents: 50000,
				asOfDate: '2026-07-01',
				annualInterestRateBps: 0
			}
		});
		await db
			.prepare(
				`INSERT INTO transactions (id,account_id,category_id,dedupe_key,booking_date,amount_cents,payee,search_text)
			 VALUES ('loan-category',?,'cat-installment-plan','loan-category','2026-07-10',-10000,'Loan Bank','Loan Bank')`
			)
			.bind(account.id)
			.run();
		await reconcilePlans(db);
		expect(firstValue<number>(sqlite, 'SELECT amount_cents FROM marked_liabilities')).toBe(40000);

		await updateTransaction(db, { id: 'loan-category', categoryId: 'cat-leisure' });

		expect(firstValue<number>(sqlite, 'SELECT amount_cents FROM marked_liabilities')).toBe(50000);
		expect(await getPlan(db, plan.id)).toMatchObject({
			status: 'active',
			nextDate: '2026-07-10',
			transactionCount: 0
		});
	});

	it('leaves a changed transaction open when no or multiple plans match', async () => {
		const account = await createAccount(db, { name: 'Checking' });
		const oldPlan = await createPlan(db, {
			accountId: account.id,
			categoryId: 'cat-groceries',
			direction: 'expense',
			cadence: 'once',
			amountCents: 1000,
			nextDate: '2026-07-10'
		});
		await db
			.prepare(
				`INSERT INTO transactions (id,account_id,category_id,dedupe_key,booking_date,amount_cents,search_text)
			 VALUES ('no-new-plan',?,'cat-groceries','no-new-plan','2026-07-10',-1000,'')`
			)
			.bind(account.id)
			.run();
		await reconcilePlans(db);
		await updateTransaction(db, { id: 'no-new-plan', categoryId: 'cat-leisure' });
		expect(
			firstValue<number>(
				sqlite,
				"SELECT COUNT(*) FROM plan_transactions WHERE transaction_id='no-new-plan'"
			)
		).toBe(0);
		expect((await getPlan(db, oldPlan.id))?.status).toBe('active');

		await createPlan(db, {
			accountId: account.id,
			categoryId: 'cat-leisure',
			direction: 'expense',
			cadence: 'once',
			amountCents: 2000,
			nextDate: '2026-07-11'
		});
		await createPlan(db, {
			accountId: account.id,
			categoryId: 'cat-leisure',
			direction: 'expense',
			cadence: 'once',
			amountCents: 2000,
			nextDate: '2026-07-11'
		});
		await db
			.prepare(
				`INSERT INTO transactions (id,account_id,category_id,dedupe_key,booking_date,amount_cents,search_text)
			 VALUES ('ambiguous-new-plan',?,'cat-groceries','ambiguous-new-plan','2026-07-11',-2000,'')`
			)
			.bind(account.id)
			.run();
		await updateTransaction(db, { id: 'ambiguous-new-plan', categoryId: 'cat-leisure' });
		expect(
			firstValue<number>(
				sqlite,
				"SELECT COUNT(*) FROM plan_transactions WHERE transaction_id='ambiguous-new-plan'"
			)
		).toBe(0);
	});

	it('retains automatic links for categoryless or equally categorized plans', async () => {
		const account = await createAccount(db, { name: 'Checking' });
		const categoryless = await createPlan(db, {
			accountId: account.id,
			direction: 'expense',
			cadence: 'once',
			amountCents: 1000,
			nextDate: '2026-07-10'
		});
		await db
			.prepare(
				`INSERT INTO transactions (id,account_id,category_id,dedupe_key,booking_date,amount_cents,search_text)
			 VALUES ('categoryless-link',?,'cat-groceries','categoryless-link','2026-07-10',-1000,'')`
			)
			.bind(account.id)
			.run();
		await reconcilePlans(db);
		await updateTransaction(db, { id: 'categoryless-link', categoryId: 'cat-leisure' });
		expect(
			firstValue<string>(
				sqlite,
				"SELECT plan_id FROM plan_transactions WHERE transaction_id='categoryless-link'"
			)
		).toBe(categoryless.id);

		const sameCategory = await createPlan(db, {
			accountId: account.id,
			categoryId: 'cat-leisure',
			direction: 'expense',
			cadence: 'once',
			amountCents: 2000,
			nextDate: '2026-07-11'
		});
		await db
			.prepare(
				`INSERT INTO transactions (id,account_id,category_id,dedupe_key,booking_date,amount_cents,search_text)
			 VALUES ('same-category-link',?,'cat-leisure','same-category-link','2026-07-11',-2000,'')`
			)
			.bind(account.id)
			.run();
		await reconcilePlans(db);
		await updateTransaction(db, { id: 'same-category-link', categoryId: 'cat-leisure' });
		expect(
			firstValue<string>(
				sqlite,
				"SELECT plan_id FROM plan_transactions WHERE transaction_id='same-category-link'"
			)
		).toBe(sameCategory.id);
	});

	it('rematches invalid links after bulk rule application and global reclassification', async () => {
		const account = await createAccount(db, { name: 'Checking' });
		const bulkPlan = await createPlan(db, {
			accountId: account.id,
			categoryId: 'cat-groceries',
			counterparty: 'Cafe Central',
			direction: 'expense',
			cadence: 'once',
			amountCents: 500,
			nextDate: '2026-07-10'
		});
		await db
			.prepare(
				`INSERT INTO transactions (id,account_id,category_id,dedupe_key,booking_date,amount_cents,payee,search_text,classification_status)
			 VALUES ('bulk-target',?,'cat-groceries','bulk-target','2026-07-10',-500,'Cafe Central','Cafe Central','unknown'),
			 ('bulk-source',?,NULL,'bulk-source','2026-07-11',-400,'Cafe','Cafe','unknown')`
			)
			.bind(account.id, account.id)
			.run();
		await reconcilePlans(db);
		await updateTransaction(db, {
			id: 'bulk-source',
			categoryId: 'cat-leisure',
			createRule: true,
			applyRuleToExisting: true,
			ruleName: 'Cafe bulk'
		});
		expect(
			firstValue<number>(
				sqlite,
				"SELECT COUNT(*) FROM plan_transactions WHERE plan_id='" + bulkPlan.id + "'"
			)
		).toBe(0);

		const globalPlan = await createPlan(db, {
			accountId: account.id,
			categoryId: 'cat-groceries',
			counterparty: 'Global Shop',
			direction: 'expense',
			cadence: 'once',
			amountCents: 600,
			nextDate: '2026-07-12'
		});
		await db
			.prepare(
				`INSERT INTO transactions (id,account_id,category_id,dedupe_key,booking_date,amount_cents,payee,search_text,classification_status)
			 VALUES ('global-target',?,'cat-groceries','global-target','2026-07-12',-600,'Global Shop','Global Shop','auto')`
			)
			.bind(account.id)
			.run();
		await db
			.prepare(
				`INSERT INTO category_rules (id,category_id,name,field,operator,pattern,priority,is_global)
			 VALUES ('global-leisure','cat-leisure','Global leisure','payee','equals','Global Shop',1,1)`
			)
			.run();
		await reconcilePlans(db);
		await reclassifyTransactions(db);
		expect(
			firstValue<number>(
				sqlite,
				"SELECT COUNT(*) FROM plan_transactions WHERE plan_id='" + globalPlan.id + "'"
			)
		).toBe(0);
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
	const importAccount = { ...account, accountId: account.id, bankId: 'dkb_girocard' as const };
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
		accountId: importAccount.accountId,
		adapterId: importAccount.bankId,
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
