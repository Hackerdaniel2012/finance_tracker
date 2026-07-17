import { expect, test } from '@playwright/test';

const emptySummary = {
	summary: {
		range: { from: '2026-01-01', to: '2026-03-31' },
		totals: {
			incomeCents: 0,
			expenseCents: 0,
			netCents: 0,
			transactionCount: 0,
			unknownCount: 0
		},
		byAccount: [],
		byCategory: [],
		byMonthCategory: [],
		recentTransactions: []
	}
};

const emptyNetWorth = {
	netWorth: {
		points: [],
		accounts: [],
		liabilities: []
	}
};

test('shows dashboard skeletons only while data is loading and respects reduced motion', async ({
	page
}) => {
	let releaseSummary!: () => void;
	const summaryGate = new Promise<void>((resolve) => {
		releaseSummary = resolve;
	});

	await page.emulateMedia({ reducedMotion: 'reduce' });
	await page.route('**/api/summary*', async (route) => {
		await summaryGate;
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(emptySummary)
		});
	});
	await page.route('**/api/net-worth*', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(emptyNetWorth)
		})
	);

	await page.goto('/');
	const skeleton = page.locator('.skeleton-shimmer').first();
	await expect(skeleton).toBeVisible();
	await expect(skeleton).toHaveCSS('animation-name', 'none');
	await expect(page.locator('[aria-busy="true"]')).not.toHaveCount(0);

	releaseSummary();
	await expect(page.locator('.skeleton-shimmer')).toHaveCount(0);
	await expect(
		page.getByText(/no net worth data yet|noch keine nettovermoegensdaten/i).first()
	).toBeVisible();
	await expect(
		page.getByRole('switch', {
			name: /include liabilities|verbindlichkeiten einbeziehen/i
		})
	).toHaveCount(0);
});

test('replaces a failed dashboard request with a retryable local error', async ({ page }) => {
	let failSummary = true;
	await page.route('**/api/summary*', async (route) => {
		if (failSummary) {
			await route.fulfill({ status: 500, contentType: 'text/plain', body: 'failed' });
			return;
		}
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(emptySummary)
		});
	});

	await page.goto('/');
	const retry = page.getByRole('button', { name: /retry|erneut versuchen/i });
	await expect(retry).toBeVisible();
	await expect(page.getByText(/^loading$|^ready$|^lädt$|^bereit$/i)).toHaveCount(0);

	failSummary = false;
	await retry.click();
	await expect(retry).toHaveCount(0);
});

test('keeps an account action label visible while its button spinner is active', async ({
	page
}) => {
	let releaseCreate!: () => void;
	const createGate = new Promise<void>((resolve) => {
		releaseCreate = resolve;
	});
	await page.route('**/api/accounts', async (route) => {
		if (route.request().method() !== 'POST') return route.continue();
		await createGate;
		await route.continue();
	});

	await page.goto('/accounts');
	await page.waitForLoadState('networkidle');
	await page.getByLabel(/account name|kontoname/i).fill(`Loading feedback ${Date.now()}`);
	const createButton = page.getByRole('button', { name: /create account|konto erstellen/i });
	await createButton.click();
	await expect(createButton).toHaveAttribute('aria-busy', 'true');
	await expect(createButton.locator('svg.animate-spin')).toBeVisible();
	await expect(createButton).toContainText(/create account|konto erstellen/i);

	releaseCreate();
	await expect(createButton).toHaveAttribute('aria-busy', 'false');
	await expect(page.getByText(/account created|konto erstellt/i)).toBeVisible();
});
