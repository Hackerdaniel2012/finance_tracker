import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test('creates an account, imports a fixture, reviews an unknown transaction, and refreshes dashboard data', async ({
	page
}) => {
	const suffix = `${Date.now()}`;
	const accountName = `E2E DKB ${suffix}`;
	const categoryName = 'Groceries';
	const reviewNote = `reviewed-${suffix}`;
	const navigate = async (path: string) => {
		await page.goto(path);
		await page.waitForLoadState('networkidle');
	};

	await navigate('/accounts');
	await expect(page.getByText(/^Ready$|^Bereit$/i)).toBeVisible();

	await page.getByLabel(/account name|kontoname/i).fill(accountName);
	const institutionPicker = page.getByRole('button', { name: /institution/i });
	await institutionPicker.click();
	await expect(institutionPicker).toHaveAttribute('aria-expanded', 'true');
	await page.getByRole('option', { name: 'DKB', exact: true }).click();
	const accountResponse = page.waitForResponse(
		(response) => response.url().includes('/api/accounts') && response.request().method() === 'POST'
	);
	await page.getByRole('button', { name: /create account|konto erstellen/i }).click();
	const createdAccountResponse = await accountResponse;
	expect(createdAccountResponse.ok()).toBe(true);
	const createdAccount = (await createdAccountResponse.json()) as { account: { id: string } };
	expect(createdAccount.account.id).toBeTruthy();
	await expect(page.getByRole('heading', { name: accountName })).toBeVisible();

	await navigate('/imports');
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
	await expect(page.getByRole('heading', { name: `${accountName} / DKB Giro Card` })).toBeVisible({
		timeout: 60_000
	});
	await expect(
		page.getByRole('button', { name: /delete import|import loeschen/i }).first()
	).toBeVisible();

	await navigate('/transactions');
	await page.getByLabel(/search transactions|transaktionen suchen/i).fill('Example Market');
	await page.getByRole('button', { name: /apply filters|filter anwenden/i }).click();
	await expect(page.getByText(/Example Market/i).first()).toBeVisible();

	await navigate('/review');
	await expect(page.getByText(/^Review queue ready$|^Pruefung bereit$/i)).toBeVisible();
	const reviewQueue = page
		.getByRole('heading', { name: /unknown review queue|unbekannte transaktionen/i })
		.locator('xpath=ancestor::section[1]');
	await reviewQueue.getByLabel(/search transactions|transaktionen suchen/i).fill('Example Market');
	await reviewQueue.getByRole('button', { name: /apply filters|filter anwenden/i }).click();
	await expect(reviewQueue).toContainText(/Example Market/i);
	await reviewQueue
		.locator('button')
		.filter({ hasText: /Example Market/i })
		.first()
		.click();

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

	await navigate('/transactions');
	await page.getByLabel(/category|kategorie/i).selectOption({ label: categoryName });
	await page.getByRole('button', { name: /apply filters|filter anwenden/i }).click();
	await expect(page.getByRole('table')).toContainText(categoryName);
	await expect(page.getByRole('table')).toContainText(/manual|manuell/i);

	await navigate('/');
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
	const scopedBalanceBeforeIncomeResponse = page.waitForResponse(
		(response) => response.url().includes('/api/balance-before-income?accountId=') && response.ok()
	);
	await page.getByRole('button', { name: /dashboard account|dashboard-konto/i }).click();
	await page.getByRole('option', { name: accountName, exact: true }).click();
	await scopedSummaryResponse;
	await scopedNetWorthResponse;
	await scopedMonthCashflowResponse;
	await scopedBalanceBeforeIncomeResponse;
	await expect(
		page
			.getByRole('heading', { name: /recent transactions|letzte transaktionen/i })
			.locator('xpath=ancestor::article[1]')
	).toContainText(/Example Market|Example Employer|Example Cafe/i);

	await navigate('/planning');
	const planName = `E2E plan ${suffix}`;
	await page.getByLabel(/counterparty|zahlungspartner/i).fill('Example Market');
	await page.getByLabel(/^label$/i).fill(planName);
	await page.getByLabel(/amount|betrag/i).fill('42.50');
	await page.getByRole('button', { name: /^account$|^konto$/i }).click();
	await page.getByRole('option', { name: accountName, exact: true }).click();
	await page.getByRole('button', { name: /next date|naechstes datum/i }).click();
	await page.getByRole('button', { name: /07\/01\/2026|01\.07\.2026/ }).click();
	const createPlanResponse = page.waitForResponse(
		(response) => response.url().endsWith('/api/plans') && response.request().method() === 'POST'
	);
	await page.getByRole('button', { name: /create plan|plan erstellen/i }).click();
	expect((await createPlanResponse).ok()).toBe(true);
	const planRow = page.getByText(planName, { exact: true }).locator('xpath=ancestor::article[1]');
	await expect(planRow).toContainText(/done|erledigt/i);

	await navigate('/imports');
	const deleteImportResponse = page.waitForResponse(
		(response) =>
			response.url().includes('/api/imports/') && response.request().method() === 'DELETE'
	);
	await page
		.getByRole('button', { name: /delete import|import loeschen/i })
		.first()
		.click();
	expect((await deleteImportResponse).ok()).toBe(true);
	await navigate('/planning');
	const restoredPlanRow = page
		.getByText(planName, { exact: true })
		.locator('xpath=ancestor::article[1]');
	await expect(restoredPlanRow).toContainText(/active|aktiv/i);

	await navigate('/accounts');
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
