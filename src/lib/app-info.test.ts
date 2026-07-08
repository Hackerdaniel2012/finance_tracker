import { describe, expect, it } from 'vitest';
import { appInfo } from './app-info';

describe('appInfo', () => {
	it('tracks the scaffold capabilities', () => {
		expect(appInfo.name).toBe('finance-tracker');
		expect(appInfo.features).toContain('cloudflare-pages');
		expect(appInfo.features).toContain('layerchart');
	});
});
