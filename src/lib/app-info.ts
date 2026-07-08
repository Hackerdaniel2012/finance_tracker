export const appInfo = {
	name: 'finance-tracker',
	version: '0.0.1',
	features: [
		'sveltekit',
		'cloudflare-pages',
		'tailwind',
		'paraglide',
		'vitest',
		'playwright',
		'layerchart'
	]
} as const;

export type AppInfo = typeof appInfo;
