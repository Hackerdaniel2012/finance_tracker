import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test('creates an account, imports a fixture, reviews an unknown transaction, and refreshes dashboard data', async ({
	page
}) => {
	const suffix = `${Date.now()}`;
	const accountName = `E2E DKB ${suffix}`;
	const categoryName = 'Groceries';
	const reviewNote = `reviewed-${suffix}`;

	await page.goto('/accounts');
	await expect(page.getByText(/^Ready$|^Bereit$/i)).toBeVisible();

	await page.getByLabel(/account name|kontoname/i).fill(accountName);
	await page.getByLabel(/institution/i).selectOption('DKB');
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
	await page.getByRole('option', { name: /dkb giro card|dkb giro card/i }).click();
	await importForm
		.getByLabel(/csv file|csv-datei/i)
		.setInputFiles(resolve('tests/fixtures/dkb-giro-basic.csv'));
	await importForm.getByRole('button', { name: /preview import|import pruefen/i }).click();
	await expect(
		page.getByRole('button', { name: /confirm import|import bestaetigen/i })
	).toBeVisible();
	await expect(page.getByText(/Example Market/i).first()).toBeVisible();

	await page.getByRole('button', { name: /confirm import|import bestaetigen/i }).click();
	await expect(page.getByRole('heading', { name: `${accountName} / dkb_girocard` })).toBeVisible({
		timeout: 60_000
	});
	await expect(
		page.getByRole('button', { name: /delete import|import loeschen/i }).first()
	).toBeVisible();

	await page.goto('/transactions');
	await page.getByLabel(/search transactions|transaktionen suchen/i).fill('REWE');
	await page.getByRole('button', { name: /apply filters|filter anwenden/i }).click();
	await expect(page.getByText(/Example Market/i).first()).toBeVisible();

	await page.goto('/review');
	await expect(page.getByText(/^Review queue ready$|^Pruefung bereit$/i)).toBeVisible();
	const reviewQueue = page
		.getByRole('heading', { name: /unknown review queue|unbekannte transaktionen/i })
		.locator('xpath=ancestor::section[1]');
	await reviewQueue.getByLabel(/search transactions|transaktionen suchen/i).fill('REWE');
	await reviewQueue.getByRole('button', { name: /apply filters|filter anwenden/i }).click();
	await expect(reviewQueue).toContainText(/REWE/i);
	await reviewQueue.locator('button').filter({ hasText: /REWE/i }).first().click();

	const classificationForm = page
		.getByRole('button', { name: /save classification|klassifizierung speichern/i })
		.locator('xpath=ancestor::form');
	await classificationForm.getByRole('combobox').first().selectOption({ label: categoryName });
	await classificationForm.getByLabel(/notes|notizen/i).fill(reviewNote);
	await classificationForm.getByLabel(/tags/i).fill('e2e-smoke');
	await classificationForm
		.getByRole('button', { name: /save classification|klassifizierung speichern/i })
		.click();
	await expect(
		page.getByText(/select an unknown transaction|unbekannte transaktion auswaehlen/i)
	).toBeVisible();

	await page.goto('/transactions');
	await page.getByLabel(/category|kategorie/i).selectOption({ label: categoryName });
	await page.getByRole('button', { name: /apply filters|filter anwenden/i }).click();
	await expect(page.getByRole('table')).toContainText(categoryName);
	await expect(page.getByRole('table')).toContainText(/manual|manuell/i);

	await page.goto('/');
	await expect(page.getByRole('heading', { name: /net worth|nettovermoegen/i })).toBeVisible();
	const scopedSummaryResponse = page.waitForResponse(
		(response) => response.url().includes('/api/summary?accountId=') && response.ok()
	);
	const scopedNetWorthResponse = page.waitForResponse(
		(response) => response.url().includes('/api/net-worth?accountId=') && response.ok()
	);
	const scopedMonthCashflowResponse = page.waitForResponse(
		(response) => response.url().includes('/api/month-cashflow?accountId=') && response.ok()
	);
	const scopedBalanceBeforeSalaryResponse = page.waitForResponse(
		(response) => response.url().includes('/api/balance-before-salary?accountId=') && response.ok()
	);
	await page.getByLabel(/dashboard account|dashboard-konto/i).selectOption({ label: accountName });
	await scopedSummaryResponse;
	await scopedNetWorthResponse;
	await scopedMonthCashflowResponse;
	await scopedBalanceBeforeSalaryResponse;
	await expect(page.getByRole('heading', { name: accountName })).toBeVisible();
	await expect(
		page
			.getByRole('heading', { name: /recent transactions|letzte transaktionen/i })
			.locator('xpath=ancestor::article[1]')
	).toContainText(/REWE|AMAZON|JET/i);

	await page.goto('/planning');
	const contractName = `E2E contract ${suffix}`;
	const updatedContractName = `${contractName} updated`;
	const contractForm = page
		.getByRole('button', { name: /create contract|vertrag erstellen/i })
		.locator('xpath=ancestor::form');
	await contractForm.getByLabel(/contract name|vertragsname/i).fill(contractName);
	await contractForm.getByLabel(/payee|empfaenger/i).fill('E2E employer');
	await contractForm.getByLabel(/amount|betrag/i).fill('1250');
	await contractForm.getByLabel(/account|konto/i).selectOption({ label: accountName });
	const createContractResponse = page.waitForResponse(
		(response) =>
			response.url().endsWith('/api/contracts') && response.request().method() === 'POST'
	);
	await contractForm.getByRole('button', { name: /create contract|vertrag erstellen/i }).click();
	expect((await createContractResponse).ok()).toBe(true);
	await expect(page.getByText(contractName, { exact: true })).toBeVisible();

	await page
		.getByRole('button', { name: /edit contract|vertrag bearbeiten/i })
		.first()
		.click();
	const editContractForm = page
		.getByRole('button', { name: /save contract|vertrag speichern/i })
		.locator('xpath=ancestor::form');
	await editContractForm.getByLabel(/contract name|vertragsname/i).fill(updatedContractName);
	const updateContractResponse = page.waitForResponse(
		(response) =>
			response.url().endsWith('/api/contracts') && response.request().method() === 'PATCH'
	);
	await editContractForm.getByRole('button', { name: /save contract|vertrag speichern/i }).click();
	expect((await updateContractResponse).ok()).toBe(true);
	await expect(page.getByText(updatedContractName, { exact: true })).toBeVisible();

	const paymentPayee = `E2E payment ${suffix}`;
	const updatedPaymentPayee = `${paymentPayee} updated`;
	const paymentForm = page
		.getByRole('button', { name: /create planned payment|geplante zahlung erstellen/i })
		.locator('xpath=ancestor::form');
	await paymentForm.getByLabel(/payee|empfaenger/i).fill(paymentPayee);
	await paymentForm.getByLabel(/amount|betrag/i).fill('45');
	const createPaymentResponse = page.waitForResponse(
		(response) =>
			response.url().endsWith('/api/planned-payments') && response.request().method() === 'POST'
	);
	await paymentForm
		.getByRole('button', { name: /create planned payment|geplante zahlung erstellen/i })
		.click();
	expect((await createPaymentResponse).ok()).toBe(true);
	await expect(page.getByText(paymentPayee, { exact: true })).toBeVisible();
	await page
		.getByRole('button', { name: /edit planned payment|geplante zahlung bearbeiten/i })
		.first()
		.click();
	const editPaymentForm = page
		.getByRole('button', { name: /save planned payment|geplante zahlung speichern/i })
		.locator('xpath=ancestor::form');
	await editPaymentForm.getByLabel(/payee|empfaenger/i).fill(updatedPaymentPayee);
	const updatePaymentResponse = page.waitForResponse(
		(response) =>
			response.url().endsWith('/api/planned-payments') && response.request().method() === 'PATCH'
	);
	await editPaymentForm
		.getByRole('button', { name: /save planned payment|geplante zahlung speichern/i })
		.click();
	expect((await updatePaymentResponse).ok()).toBe(true);
	await expect(page.getByText(updatedPaymentPayee, { exact: true })).toBeVisible();

	const incomePayer = `E2E income ${suffix}`;
	const updatedIncomePayer = `${incomePayer} updated`;
	const incomeForm = page
		.getByRole('button', { name: /create planned income|geplante einnahme erstellen/i })
		.locator('xpath=ancestor::form');
	await incomeForm.getByLabel(/payer|zahler/i).fill(incomePayer);
	await incomeForm.getByLabel(/amount|betrag/i).fill('80');
	const createIncomeResponse = page.waitForResponse(
		(response) =>
			response.url().endsWith('/api/planned-income') && response.request().method() === 'POST'
	);
	await incomeForm
		.getByRole('button', { name: /create planned income|geplante einnahme erstellen/i })
		.click();
	expect((await createIncomeResponse).ok()).toBe(true);
	await expect(page.getByText(incomePayer, { exact: true })).toBeVisible();
	await page
		.getByRole('button', { name: /edit planned income|geplante einnahme bearbeiten/i })
		.first()
		.click();
	const editIncomeForm = page
		.getByRole('button', { name: /save planned income|geplante einnahme speichern/i })
		.locator('xpath=ancestor::form');
	await editIncomeForm.getByLabel(/payer|zahler/i).fill(updatedIncomePayer);
	const updateIncomeResponse = page.waitForResponse(
		(response) =>
			response.url().endsWith('/api/planned-income') && response.request().method() === 'PATCH'
	);
	await editIncomeForm
		.getByRole('button', { name: /save planned income|geplante einnahme speichern/i })
		.click();
	expect((await updateIncomeResponse).ok()).toBe(true);
	await expect(page.getByText(updatedIncomePayer, { exact: true })).toBeVisible();

	await page.goto('/accounts');
	page.on('dialog', (dialog) => void dialog.accept());
	const accountRow = page
		.getByRole('heading', { name: accountName })
		.locator('xpath=ancestor::article[1]');
	const deleteResponse = page.waitForResponse(
		(response) =>
			response.url().endsWith(`/api/accounts/${createdAccount.account.id}`) &&
			response.request().method() === 'DELETE'
	);
	await accountRow.getByRole('button', { name: /delete|loeschen/i }).click();
	expect((await deleteResponse).ok()).toBe(true);
	await expect(accountRow).not.toBeVisible();
});
