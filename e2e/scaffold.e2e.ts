import { expect, test } from '@playwright/test';

test('renders the scaffold dashboard shell', async ({ page }) => {
	await page.goto('/');

	await expect(page.getByRole('heading', { name: /finance tracker|finanztracker/i })).toBeVisible();
	await expect(page.getByRole('heading', { name: /net worth|nettovermoegen/i })).toBeVisible();
	await expect(page.getByLabel(/dashboard account|dashboard-konto/i)).toBeVisible();
	await expect(
		page.getByRole('heading', { name: /cashflow this month|cashflow diesen monat/i })
	).toBeVisible();
	await expect(page.getByRole('button', { name: /create account|konto erstellen/i })).toBeVisible();
});

test('renders the CSV import shell', async ({ page }) => {
	await page.goto('/imports');

	await expect(page.getByRole('heading', { name: /^imports$|^importe$/i })).toBeVisible();
	await expect(page.getByRole('heading', { name: /upload csv|csv hochladen/i })).toBeVisible();
	await expect(page.getByRole('button', { name: /preview import|import pruefen/i })).toBeVisible();
});

test('renders the account management shell', async ({ page }) => {
	await page.goto('/accounts');

	await expect(
		page.getByRole('heading', { name: /account summary|kontouebersicht/i })
	).toBeVisible();
	await expect(page.getByRole('heading', { name: /^accounts$|^konten$/i })).toBeVisible();
	await expect(page.getByRole('button', { name: /create account|konto erstellen/i })).toBeVisible();
});

test('renders the transaction review shell', async ({ page }) => {
	await page.goto('/transactions');

	await expect(page.getByRole('heading', { name: /transactions|transaktionen/i })).toBeVisible();
	await expect(page.getByRole('heading', { name: /filters|filter/i })).toBeVisible();
	await expect(page.getByLabel(/^account$|^konto$/i)).toBeVisible();
	await expect(page.getByLabel(/transaction direction|transaktionsrichtung/i)).toBeVisible();
	await expect(page.getByLabel(/minimum amount|mindestbetrag/i)).toBeVisible();
	await expect(page.getByLabel(/^tag$/i)).toBeVisible();
	await expect(page.getByRole('button', { name: /apply filters|filter anwenden/i })).toBeVisible();
});

test('renders the category review shell', async ({ page }) => {
	await page.goto('/review');

	await expect(page.getByRole('heading', { name: /^review$|^pruefung$/i })).toBeVisible();
	await expect(
		page.getByRole('heading', { name: /unknown review queue|unbekannte transaktionen/i })
	).toBeVisible();
	await expect(page.getByLabel(/search transactions|transaktionen suchen/i)).toBeVisible();
	await expect(page.getByRole('button', { name: /previous|zurueck/i })).toBeVisible();
	await expect(page.getByRole('button', { name: /next|weiter/i })).toBeVisible();
	await expect(page.getByRole('heading', { name: /categories|kategorien/i })).toBeVisible();
	await expect(
		page.getByRole('heading', { name: /category rules|kategorieregeln/i })
	).toBeVisible();
});

test('renders the planning shell', async ({ page }) => {
	await page.goto('/planning');

	await expect(page.getByRole('heading', { name: /^planning$|^planung$/i })).toBeVisible();
	await expect(page.getByRole('heading', { name: /contracts|vertraege/i })).toBeVisible();
	await expect(
		page.getByRole('heading', { name: /^planned payments$|^geplante zahlungen$/i })
	).toBeVisible();
	await expect(
		page.getByRole('heading', { name: /^planned income$|^geplante einnahmen$/i })
	).toBeVisible();
	await expect(
		page.getByRole('heading', { name: /^liabilities$|^verbindlichkeiten$/i })
	).toBeVisible();
	await expect(
		page.getByLabel(/manual next salary date|manuelles naechstes gehaltsdatum/i)
	).toBeVisible();
});
