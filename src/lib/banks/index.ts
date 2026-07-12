export type { BankAdapter, BankId, NormalizedTransaction, ParseError, ParseResult } from './types';
export { dkbAdapter } from './dkb-girocard';
export { dkbCreditcardAdapter } from './dkb-creditcard';
export { n26Adapter } from './n26';
export { tradeRepublicAdapter } from './trade-republic';

import { dkbAdapter } from './dkb-girocard';
import { dkbCreditcardAdapter } from './dkb-creditcard';
import { n26Adapter } from './n26';
import { tradeRepublicAdapter } from './trade-republic';
import type { BankAdapter, BankId } from './types';

export const bankAdapters = [
	n26Adapter,
	tradeRepublicAdapter,
	dkbAdapter,
	dkbCreditcardAdapter
] as const satisfies readonly BankAdapter[];

export function getBankAdapter(bankId: BankId): BankAdapter {
	const adapter = bankAdapters.find((candidate) => candidate.id === bankId);

	if (!adapter) {
		throw new Error(`Unsupported bank adapter: ${bankId}`);
	}

	return adapter;
}
