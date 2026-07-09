import { defineConfig } from '@playwright/test';

export default defineConfig({
	timeout: 180_000,
	workers: 1,
	webServer: {
		command: 'pnpm dev --host 127.0.0.1 --port 4173',
		port: 4173,
		timeout: 120_000
	},
	testMatch: '**/*.e2e.{ts,js}'
});
