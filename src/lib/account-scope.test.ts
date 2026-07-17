import { describe, expect, it } from 'vitest';
import { buildAccountScopeOptions, buildAccountScopeQuery, parseAccountScope } from './account-scope';

describe('account scope', () => {
	it('uses real accounts as the only selectable scope', () => {
		expect(buildAccountScopeOptions([{ id: 'acc-1', name: 'N26' }, { id: 'acc-2', name: 'DKB' }])).toEqual([
			{ value: 'acc-1', label: 'N26' },
			{ value: 'acc-2', label: 'DKB' }
		]);
		expect(parseAccountScope('acc-1')).toEqual({ accountId: 'acc-1' });
		expect(buildAccountScopeQuery('acc-1')).toBe('?accountId=acc-1');
	});
});
