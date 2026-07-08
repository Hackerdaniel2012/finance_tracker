export type { BankAdapter, BankId, NormalizedTransaction, ParseError, ParseResult } from './types';
export { dkbAdapter } from './dkb';
export { n26Adapter } from './n26';
export { tradeRepublicAdapter } from './trade-republic';

import { dkbAdapter } from './dkb';
import { n26Adapter } from './n26';
import { tradeRepublicAdapter } from './trade-republic';
import type { BankAdapter, BankId } from './types';

export const bankAdapters = [
	n26Adapter,
	tradeRepublicAdapter,
	dkbAdapter
] as const satisfies readonly BankAdapter[];

export function getBankAdapter(bankId: BankId): BankAdapter {
	const adapter = bankAdapters.find((candidate) => candidate.id === bankId);

	if (!adapter) {
		throw new Error(`Unsupported bank adapter: ${bankId}`);
	}

	return adapter;
}
