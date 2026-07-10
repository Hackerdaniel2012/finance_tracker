import { describe, expect, it } from 'vitest';
import {
	buildAccountScopeOptions,
	buildAccountScopeQuery,
	parseAccountScope
} from './account-scope';

describe('account-scope helpers', () => {
	describe('buildAccountScopeOptions', () => {
		it('renders plain accounts without subaccounts', () => {
			const options = buildAccountScopeOptions([{ id: 'acc-1', name: 'DKB', subaccounts: [] }]);

			expect(options).toEqual([{ value: 'acc-1', label: 'DKB' }]);
		});

		it('renders an "All" option and one option per subaccount', () => {
			const options = buildAccountScopeOptions([
				{ id: 'acc-1', name: 'N26', subaccounts: ['Hauptkonto', '20k in 2023'] }
			]);

			expect(options).toEqual([
				{ value: 'acc-1', label: 'N26 - All' },
				{ value: 'acc-1:Hauptkonto', label: 'N26 - Hauptkonto' },
				{ value: 'acc-1:20k%20in%202023', label: 'N26 - 20k in 2023' }
			]);
		});

		it('mixes plain and subaccount-bearing accounts', () => {
			const options = buildAccountScopeOptions([
				{ id: 'acc-1', name: 'N26', subaccounts: ['Hauptkonto'] },
				{ id: 'acc-2', name: 'DKB', subaccounts: [] }
			]);

			expect(options).toEqual([
				{ value: 'acc-1', label: 'N26 - All' },
				{ value: 'acc-1:Hauptkonto', label: 'N26 - Hauptkonto' },
				{ value: 'acc-2', label: 'DKB' }
			]);
		});
	});

	describe('parseAccountScope', () => {
		it('returns accountId only for plain values', () => {
			expect(parseAccountScope('acc-1')).toEqual({ accountId: 'acc-1' });
		});

		it('decodes the subaccount name from encoded values', () => {
			expect(parseAccountScope('acc-1:Hauptkonto')).toEqual({
				accountId: 'acc-1',
				subaccount: 'Hauptkonto'
			});
			expect(parseAccountScope('acc-1:20k%20in%202023')).toEqual({
				accountId: 'acc-1',
				subaccount: '20k in 2023'
			});
		});
	});

	describe('buildAccountScopeQuery', () => {
		it('builds an account-only query', () => {
			expect(buildAccountScopeQuery('acc-1')).toBe('?accountId=acc-1');
		});

		it('builds a query with subaccount', () => {
			expect(buildAccountScopeQuery('acc-1:Hauptkonto')).toBe(
				'?accountId=acc-1&subaccount=Hauptkonto'
			);
		});
	});
});
