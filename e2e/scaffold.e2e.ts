import { expect, test } from '@playwright/test';

test('renders the scaffold dashboard shell', async ({ page }) => {
	await page.goto('/');

	await expect(page.getByRole('heading', { name: /finance tracker|finanztracker/i })).toBeVisible();
	await expect(page.getByText(/SvelteKit.*Cloudflare Pages.*LayerChart/i)).toBeVisible();
});
