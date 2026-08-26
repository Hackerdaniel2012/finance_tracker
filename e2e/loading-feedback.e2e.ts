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

test('projects multiple categories in an expandable card and remembers the selection', async ({
	page
}) => {
	let lastProjectionAccountId: string | null = null;
	await page.route('**/api/accounts', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				accounts: [
					{
						id: 'account-1',
						name: 'Test account',
						institution: null,
						balanceCents: 0,
						balanceInitialized: true
					}
				]
			})
		})
	);
	await page.route('**/api/categories', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				categories: [
					{ id: 'cat-groceries', name: 'Groceries', type: 'expense', color: '#ea580c' },
					{ id: 'cat-vehicles', name: 'Vehicles', type: 'expense', color: '#0f766e' },
					{ id: 'cat-salary', name: 'Salary', type: 'income', color: '#059669' }
				]
			})
		})
	);
	await page.route('**/api/category-cost-projection*', (route) => {
		const url = new URL(route.request().url());
		const selected = url.searchParams.getAll('categoryId');
		lastProjectionAccountId = url.searchParams.get('accountId');
		const rows = [
			{
				categoryId: 'cat-groceries',
				categoryName: 'Groceries',
				categoryColor: '#ea580c',
				actualCents: 2000,
				historicalAverageCents: 3000,
				plannedRemainingCents: 1500,
				committedCents: 3500,
				projectedCents: 3500,
				projectedRemainingCents: 1500
			},
			{
				categoryId: 'cat-vehicles',
				categoryName: 'Vehicles',
				categoryColor: '#0f766e',
				actualCents: 2000,
				historicalAverageCents: 6000,
				plannedRemainingCents: 1000,
				committedCents: 3000,
				projectedCents: 6000,
				projectedRemainingCents: 4000
			}
		].filter((row) => selected.includes(row.categoryId));
		const totals = rows.reduce(
			(result, row) => {
				for (const key of Object.keys(result) as Array<keyof typeof result>)
					result[key] += row[key];
				return result;
			},
			{
				actualCents: 0,
				historicalAverageCents: 0,
				plannedRemainingCents: 0,
				committedCents: 0,
				projectedCents: 0,
				projectedRemainingCents: 0
			}
		);
		return route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				projection: {
					range: {
						from: '2026-07-01',
						asOf: '2026-07-10',
						to: '2026-07-31',
						historyFrom: '2026-04-01',
						historyTo: '2026-06-30',
						historyMonths: ['2026-04', '2026-05', '2026-06']
					},
					categories: rows,
					totals
				}
			})
		});
	});

	await page.goto('/');
	await page.waitForLoadState('networkidle');
	await page
		.getByRole('button', {
			name: /expand category cost projection|kategoriekostenprognose aufklappen/i
		})
		.click();
	await page.getByLabel('Groceries').check();
	await page.getByLabel('Vehicles').check();
	await expect(page.getByText(/95[.,]00/).first()).toBeVisible();
	await expect(page.getByRole('row', { name: /Groceries/i })).toBeVisible();
	await expect(page.getByRole('row', { name: /Vehicles/i })).toBeVisible();

	await page.reload();
	await expect(page.getByText(/2 categories selected|2 Kategorien ausgewählt/i)).toBeVisible();
	await page
		.getByRole('button', {
			name: /expand category cost projection|kategoriekostenprognose aufklappen/i
		})
		.click();
	await expect(page.getByLabel('Groceries')).toBeChecked();
	await expect(page.getByLabel('Vehicles')).toBeChecked();

	await page.getByRole('button', { name: /dashboard account|dashboard-konto/i }).click();
	await page.getByRole('option', { name: 'Test account' }).click();
	await expect.poll(() => lastProjectionAccountId).toBe('account-1');
});
