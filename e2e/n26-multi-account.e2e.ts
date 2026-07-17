import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

test('creates two real accounts from one multi-account N26 CSV and rolls the run back together', async ({
	page
}) => {
	const suffix = `${Date.now()}`;
	const mainName = `E2E N26 Main ${suffix}`;
	const savingsName = `E2E N26 Savings ${suffix}`;
	await page.goto('/imports');
	await page.waitForLoadState('networkidle');
	await expect(
		page
			.getByRole('heading', { name: /upload csv|csv hochladen/i })
			.locator('xpath=ancestor::section[1]')
	).toHaveAttribute('aria-busy', 'false');

	const uploadForm = page
		.getByRole('button', { name: /detect accounts|konten erkennen/i })
		.locator('xpath=ancestor::form');
	await uploadForm.getByRole('button', { name: /csv scheme|csv-schema/i }).click();
	await page.getByRole('option', { name: 'N26', exact: true }).click();
	await uploadForm
		.getByLabel(/csv file|csv-datei/i)
		.setInputFiles(resolve('tests/fixtures/n26-basic.csv'));
	const previewResponse = page.waitForResponse(
		(response) =>
			response.url().endsWith('/api/imports/preview') && response.request().method() === 'POST'
	);
	await uploadForm.getByRole('button', { name: /detect accounts|konten erkennen/i }).click();
	expect((await previewResponse).ok()).toBe(true);

	const mainGroup = page
		.getByRole('heading', { name: 'Main', exact: true })
		.locator('xpath=ancestor::article[1]');
	const savingsGroup = page
		.getByRole('heading', { name: 'Savings', exact: true })
		.locator('xpath=ancestor::article[1]');
	await expect(mainGroup).toBeVisible();
	await expect(savingsGroup).toBeVisible();
	await mainGroup.getByLabel(/account name|kontoname/i).fill(mainName);
	await mainGroup.getByRole('button', { name: /balance basis|saldogrundlage/i }).click();
	await page.getByRole('option', { name: /complete history|vollständige historie/i }).click();
	await savingsGroup.getByLabel(/account name|kontoname/i).fill(savingsName);
	await savingsGroup.getByLabel(/entered balance|eingegebener kontostand/i).fill('-24.00');

	await page
		.getByRole('button', { name: /validate account setup|kontoeinrichtung prüfen/i })
		.click();
	const confirm = page.getByRole('button', { name: /confirm import|import bestätigen/i });
	await expect(confirm).toBeEnabled();
	await confirm.click();
	await expect(page.getByText(mainName).first()).toBeVisible();
	await expect(page.getByText(savingsName).first()).toBeVisible();

	await page.goto('/accounts');
	await expect(page.getByRole('heading', { name: mainName })).toBeVisible();
	await expect(page.getByRole('heading', { name: savingsName })).toBeVisible();

	await page.goto('/imports');
	const deleteButton = page.getByRole('button', { name: /delete import|import löschen/i }).first();
	await deleteButton.click();
	await expect(page.getByText(/no import batches|noch keine importläufe/i)).toBeVisible();

	await page.goto('/accounts');
	await expect(page.getByRole('heading', { name: mainName })).toBeVisible();
	await expect(page.getByRole('heading', { name: savingsName })).toBeVisible();
});

test('switching to an initialized existing account requires a reported balance', async ({ page }) => {
	const suffix = `${Date.now()}`;
	const accountName = `E2E initialized account ${suffix}`;
	const uploadForm = () =>
		page
			.getByRole('button', { name: /detect accounts|konten erkennen/i })
			.locator('xpath=ancestor::form');

	const createAccountResponse = await page.request.post('/api/accounts', {
		data: { name: accountName, institution: 'N26', displayOrder: -1 }
	});
	expect(createAccountResponse.ok()).toBe(true);

	await page.goto('/imports');
	await page.waitForLoadState('networkidle');
	await expect(
		page
			.getByRole('heading', { name: /upload csv|csv hochladen/i })
			.locator('xpath=ancestor::section[1]')
	).toHaveAttribute('aria-busy', 'false');
	await uploadForm().getByRole('button', { name: /csv scheme|csv-schema/i }).click();
	await page.getByRole('option', { name: /dkb giro card|dkb giro card/i }).click();
	await uploadForm()
		.getByLabel(/csv file|csv-datei/i)
		.setInputFiles(resolve('tests/fixtures/dkb-giro-basic.csv'));
	await uploadForm().getByRole('button', { name: /detect accounts|konten erkennen/i }).click();
	const dkbGroup = page
		.getByRole('heading', { name: /girokonto|csv account/i })
		.locator('xpath=ancestor::article[1]');
	await dkbGroup.getByRole('button', { name: /target account|zielkonto/i }).click();
	await page.getByRole('option', { name: /use existing account|bestehendes konto verwenden/i }).click();
	await dkbGroup.getByRole('button', { name: /^account$|^konto$/i }).click();
	await page.getByRole('option', { name: accountName, exact: true }).click();
	await dkbGroup.getByLabel(/entered balance|eingegebener kontostand/i).fill('1000.00');
	await page.getByRole('button', { name: /validate account setup|kontoeinrichtung prüfen/i }).click();
	const confirmInitialization = page.waitForResponse(
		(response) =>
			response.url().endsWith('/api/imports/confirm') && response.request().method() === 'POST'
	);
	await page.getByRole('button', { name: /confirm import|import bestätigen/i }).click();
	expect((await confirmInitialization).ok()).toBe(true);

	await page.goto('/imports');
	await page.waitForLoadState('networkidle');
	await expect(
		page
			.getByRole('heading', { name: /upload csv|csv hochladen/i })
			.locator('xpath=ancestor::section[1]')
	).toHaveAttribute('aria-busy', 'false');
	await uploadForm().getByRole('button', { name: /csv scheme|csv-schema/i }).click();
	await page.getByRole('option', { name: 'N26', exact: true }).click();
	await uploadForm()
		.getByLabel(/csv file|csv-datei/i)
		.setInputFiles(resolve('tests/fixtures/n26-basic.csv'));
	await uploadForm().getByRole('button', { name: /detect accounts|konten erkennen/i }).click();
	const mainGroup = page
		.getByRole('heading', { name: 'Main', exact: true })
		.locator('xpath=ancestor::article[1]');
	const savingsGroup = page
		.getByRole('heading', { name: 'Savings', exact: true })
		.locator('xpath=ancestor::article[1]');
	await mainGroup.getByRole('button', { name: /balance basis|saldogrundlage/i }).click();
	await page.getByRole('option', { name: /complete history|vollständige historie/i }).click();
	await expect(mainGroup.getByText(/complete history|vollständige historie/i)).toBeVisible();
	await mainGroup.getByRole('button', { name: /target account|zielkonto/i }).click();
	await page.getByRole('option', { name: /use existing account|bestehendes konto verwenden/i }).click();
	await mainGroup.getByRole('button', { name: /^account$|^konto$/i }).click();
	await page.getByRole('option', { name: accountName, exact: true }).click();
	await expect(mainGroup.getByRole('button', { name: /balance basis|saldogrundlage/i })).toBeDisabled();
	await mainGroup.getByLabel(/entered balance|eingegebener kontostand/i).fill('1000.00');
	await savingsGroup.getByLabel(/entered balance|eingegebener kontostand/i).fill('-24.00');
	await page.getByRole('button', { name: /validate account setup|kontoeinrichtung prüfen/i }).click();
	await expect(page.getByRole('button', { name: /confirm import|import bestätigen/i })).toBeEnabled();
});
