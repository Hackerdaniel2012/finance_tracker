import { describe, expect, it } from 'vitest';
import { getDatabase } from './db';

describe('getDatabase', () => {
	it('returns the configured DB binding', () => {
		const db = {} as D1Database;
		const platform = { env: { DB: db } } as App.Platform;

		expect(getDatabase(platform)).toBe(db);
	});

	it('fails clearly when the DB binding is unavailable', () => {
		expect(() => getDatabase(undefined)).toThrow('Cloudflare D1 binding DB is not available');
	});
});
