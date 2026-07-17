import { expect, test } from '@playwright/test';

test('renders the scaffold dashboard shell', async ({ page }) => {
	await page.route('**/api/net-worth*', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				netWorth: {
					points: [
						{
							date: '2026-07-01',
							assetsCents: 100000,
							liabilitiesCents: 200000,
							netWorthCents: -100000
						},
						{
							date: '2026-07-02',
							assetsCents: 125000,
							liabilitiesCents: 200000,
							netWorthCents: -75000
						}
					],
					accounts: [],
					liabilities: [
						{ id: 'liability-1', name: 'Loan', amountCents: 200000, asOfDate: '2026-07-01' }
					]
				}
			})
		})
	);
	await page.goto('/');

	await expect(page.getByRole('heading', { name: /net worth|nettovermoegen/i })).toBeVisible();
	const liabilityToggle = page.getByRole('switch', {
		name: /include liabilities|verbindlichkeiten einbeziehen/i
	});
	const onSymbol = liabilityToggle.locator('[data-toggle-symbol="on"]');
	const offSymbol = liabilityToggle.locator('[data-toggle-symbol="off"]');
	await expect(liabilityToggle).toHaveAttribute('aria-checked', 'false');
	await expect(onSymbol).toHaveCSS('opacity', '0');
	await expect(offSymbol).toHaveCSS('opacity', '1');
	await page.waitForLoadState('networkidle');
	const netWorthSection = page
		.getByRole('heading', { name: /net worth|nettovermoegen/i })
		.locator('xpath=ancestor::section[1]');
	await expect(netWorthSection.locator('path.lc-path')).toBeVisible();
	await page.waitForTimeout(500);
	await netWorthSection.evaluate((section) => {
		const path = section.querySelector('path.lc-path');
		const zeroLine = section.querySelector('.lc-rule-y-line');
		const zeroTick = [
			...section.querySelectorAll('.lc-axis[data-placement="left"] .lc-axis-tick-label')
		].find((label) => label.textContent?.trim() === '0');
		if (!path || !zeroLine || !zeroTick) {
			throw new Error('Expected the chart path, zero line, and zero tick');
		}

		const pathSamples = [path.getAttribute('d')];
		const zeroLineSamples = [zeroLine.getAttribute('y1')];
		const scaleSamples = [zeroTick.getAttribute('y')];
		(section as HTMLElement).dataset.pathSamples = JSON.stringify(pathSamples);
		(section as HTMLElement).dataset.zeroLineSamples = JSON.stringify(zeroLineSamples);
		(section as HTMLElement).dataset.scaleSamples = JSON.stringify(scaleSamples);

		new MutationObserver(() => {
			pathSamples.push(path.getAttribute('d'));
			(section as HTMLElement).dataset.pathSamples = JSON.stringify(pathSamples);
		}).observe(path, { attributes: true, attributeFilter: ['d'] });
		new MutationObserver(() => {
			zeroLineSamples.push(zeroLine.getAttribute('y1'));
			(section as HTMLElement).dataset.zeroLineSamples = JSON.stringify(zeroLineSamples);
		}).observe(zeroLine, { attributes: true, attributeFilter: ['y1'] });
		new MutationObserver(() => {
			scaleSamples.push(zeroTick.getAttribute('y'));
			(section as HTMLElement).dataset.scaleSamples = JSON.stringify(scaleSamples);
		}).observe(zeroTick, { attributes: true, attributeFilter: ['y'] });
	});
	await liabilityToggle.click();
	await expect(liabilityToggle).toHaveAttribute('aria-checked', 'true');
	await expect(onSymbol).toHaveCSS('opacity', '1');
	await expect(offSymbol).toHaveCSS('opacity', '0');
	await expect
		.poll(async () => {
			const samples = await netWorthSection.evaluate((section) => ({
				path: JSON.parse((section as HTMLElement).dataset.pathSamples ?? '[]') as string[],
				zeroLine: JSON.parse((section as HTMLElement).dataset.zeroLineSamples ?? '[]') as string[],
				scale: JSON.parse((section as HTMLElement).dataset.scaleSamples ?? '[]') as string[]
			}));
			return Math.min(
				new Set(samples.path).size,
				new Set(samples.zeroLine).size,
				new Set(samples.scale).size
			);
		})
		.toBeGreaterThan(2);
	const animationSamples = await netWorthSection.evaluate((section) => ({
		path: JSON.parse((section as HTMLElement).dataset.pathSamples ?? '[]') as string[],
		zeroLine: JSON.parse((section as HTMLElement).dataset.zeroLineSamples ?? '[]') as string[],
		scale: JSON.parse((section as HTMLElement).dataset.scaleSamples ?? '[]') as string[]
	}));
	expect(new Set(animationSamples.path).size).toBeGreaterThan(2);
	expect(new Set(animationSamples.zeroLine).size).toBeGreaterThan(2);
	expect(new Set(animationSamples.scale).size).toBeGreaterThan(2);
	await expect(page.getByLabel(/dashboard account|dashboard-konto/i)).toBeVisible();
	await expect(
		page.getByRole('heading', { name: /cashflow this month|cashflow diesen monat/i })
	).toBeVisible();
	await expect(page.getByRole('link', { name: /^accounts$|^konten$/i })).toBeVisible();
});

test('renders the CSV import shell', async ({ page }) => {
	await page.goto('/imports');

	await expect(page.getByRole('heading', { name: /upload csv|csv hochladen/i })).toBeVisible();
	await expect(page.getByRole('button', { name: /detect accounts|konten erkennen/i })).toBeVisible();
});

test('renders the account management shell', async ({ page }) => {
	await page.goto('/accounts');

	await expect(page.getByRole('heading', { name: /^accounts$|^konten$/i })).toBeVisible();
	await expect(page.getByRole('button', { name: /create account|konto erstellen/i })).toBeVisible();
});

test('renders the transaction review shell', async ({ page }) => {
	await page.goto('/transactions');

	await expect(page.getByRole('heading', { name: /filters|filter/i })).toBeVisible();
	await expect(page.getByLabel(/^account$|^konto$/i)).toBeVisible();
	await expect(page.getByLabel(/transaction direction|transaktionsrichtung/i)).toBeVisible();
	await expect(page.getByLabel(/minimum amount|mindestbetrag/i)).toBeVisible();
	await expect(page.getByLabel(/^tag$/i)).toBeVisible();
	await expect(page.getByRole('button', { name: /apply filters|filter anwenden/i })).toBeVisible();
});

test('renders the category review shell', async ({ page }) => {
	await page.goto('/review');

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

	await expect(page.getByRole('heading', { name: /create plan|plan erstellen/i })).toBeVisible();
	await expect(page.getByRole('heading', { name: /^expenses$|^ausgaben$/i })).toBeVisible();
	await expect(page.getByRole('heading', { name: /^income$|^einnahmen$/i })).toBeVisible();
	await expect(
		page.getByRole('heading', { name: /recurring suggestions|wiederkehrende vorschlaege/i })
	).toBeVisible();
	await expect(
		page.getByRole('heading', { name: /^liabilities$|^verbindlichkeiten$/i })
	).toBeVisible();
});
