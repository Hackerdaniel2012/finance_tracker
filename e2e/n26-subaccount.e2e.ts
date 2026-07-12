import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test('imports n26-basic.csv and scopes dashboard and transactions by subaccount', async ({
	page
}) => {
	const suffix = `${Date.now()}`;
	const accountName = `E2E N26 ${suffix}`;

	await page.goto('/');
	await expect(page.getByText(/^Ready$|^Bereit$/i)).toBeVisible();

	await page.getByLabel(/account name|kontoname/i).fill(accountName);
	await page.getByLabel(/institution/i).selectOption('N26');
	const accountResponse = page.waitForResponse(
		(response) => response.url().includes('/api/accounts') && response.request().method() === 'POST'
	);
	await page.getByRole('button', { name: /create account|konto erstellen/i }).click();
	const createdAccountResponse = await accountResponse;
	expect(createdAccountResponse.ok()).toBe(true);
	const createdAccount = (await createdAccountResponse.json()) as { account: { id: string } };
	expect(createdAccount.account.id).toBeTruthy();
	await expect(page.getByRole('heading', { name: accountName })).toBeVisible();

	await page.goto('/imports');
	await expect(page.getByText(/^Imports ready$|^Importe bereit$/i)).toBeVisible();
	const importForm = page
		.getByRole('button', { name: /preview import|import pruefen/i })
		.locator('xpath=ancestor::form');
	await importForm.getByRole('button', { name: /^account$|^konto$/i }).click();
	await page.getByRole('option', { name: accountName }).click();
	await importForm.getByRole('button', { name: /csv scheme|csv-schema/i }).click();
	await page.getByRole('option', { name: 'N26' }).click();
	await importForm
		.getByLabel(/csv file|csv-datei/i)
		.setInputFiles(resolve('tests/fixtures/n26-basic.csv'));
	await importForm.getByRole('button', { name: /preview import|import pruefen/i }).click();
	await expect(
		page.getByRole('button', { name: /confirm import|import bestaetigen/i })
	).toBeVisible({ timeout: 60_000 });
	await expect(page.getByText(/Hauptkonto|20k in 2023/i).first()).toBeVisible();

	await page.getByRole('button', { name: /confirm import|import bestaetigen/i }).click();
	await expect(page.getByRole('heading', { name: `${accountName} / n26` })).toBeVisible({
		timeout: 120_000
	});
	await expect(
		page.getByRole('button', { name: /delete import|import loeschen/i }).first()
	).toBeVisible();

	await page.goto('/');
	await expect(page.getByRole('heading', { name: /net worth|nettovermoegen/i })).toBeVisible();

	const scopeSelect = page.getByLabel(/dashboard account|dashboard-konto/i);
	await expect(scopeSelect).toContainText(`${accountName} - All`);
	await expect(scopeSelect).toContainText(`${accountName} - Hauptkonto`);
	await expect(scopeSelect).toContainText(`${accountName} - Haus Kostenstelle`);

	const allScopeResponse = page.waitForResponse(
		(response) => response.url().includes('/api/summary?accountId=') && response.ok()
	);
	await scopeSelect.selectOption({ label: `${accountName} - All` });
	const allScope = (await (await allScopeResponse).json()) as {
		summary: { totals: { transactionCount: number } };
	};
	const allTransactionCount = allScope.summary.totals.transactionCount;
	expect(allTransactionCount).toBeGreaterThan(0);

	const subaccountScopeResponse = page.waitForResponse(
		(response) =>
			response.url().includes('/api/summary?accountId=') &&
			response.url().includes('subaccount=') &&
			response.ok()
	);
	await scopeSelect.selectOption({ label: `${accountName} - Haus Kostenstelle` });
	const subaccountScope = (await (await subaccountScopeResponse).json()) as {
		summary: { totals: { transactionCount: number } };
	};
	const scopedTransactionCount = subaccountScope.summary.totals.transactionCount;
	expect(scopedTransactionCount).toBeGreaterThan(0);
	expect(scopedTransactionCount).toBeLessThan(allTransactionCount);

	await page.goto('/transactions');
	await expect(page.getByRole('heading', { name: /transactions|transaktionen/i })).toBeVisible();
	const allTransactionsResponse = page.waitForResponse(
		(response) =>
			response.url().includes('/api/transactions?') &&
			response.url().includes('accountId=') &&
			!response.url().includes('subaccount=') &&
			response.ok()
	);
	const accountFilter = page.getByLabel(/^account$|^konto$/i);
	await accountFilter.selectOption({ label: `${accountName} - All` });
	await page.getByRole('button', { name: /apply filters|filter anwenden/i }).click();
	const allTransactions = (await (await allTransactionsResponse).json()) as {
		transactions: unknown[];
		pagination: { total: number };
	};
	expect(allTransactions.pagination.total).toBeGreaterThan(0);

	const subaccountTransactionsResponse = page.waitForResponse(
		(response) =>
			response.url().includes('/api/transactions?') &&
			response.url().includes('accountId=') &&
			response.url().includes('subaccount=') &&
			response.ok()
	);
	await accountFilter.selectOption({ label: `${accountName} - Haus Kostenstelle` });
	await page.getByRole('button', { name: /apply filters|filter anwenden/i }).click();
	const subaccountTransactions = (await (await subaccountTransactionsResponse).json()) as {
		transactions: unknown[];
		pagination: { total: number };
	};
	expect(subaccountTransactions.pagination.total).toBeGreaterThan(0);
	expect(subaccountTransactions.pagination.total).toBeLessThan(allTransactions.pagination.total);
});
