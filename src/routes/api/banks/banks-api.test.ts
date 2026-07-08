import { describe, expect, it } from 'vitest';
import { GET } from './+server';

describe('/api/banks', () => {
	it('lists enabled bank adapters and required columns', async () => {
		const response = await GET({} as Parameters<typeof GET>[0]);

		await expect(response.json()).resolves.toEqual({
			banks: [
				expect.objectContaining({ id: 'n26', label: 'N26', status: 'enabled' }),
				expect.objectContaining({
					id: 'trade_republic',
					label: 'Trade Republic',
					status: 'enabled'
				}),
				expect.objectContaining({ id: 'dkb', label: 'DKB', status: 'enabled' })
			]
		});
	});
});
