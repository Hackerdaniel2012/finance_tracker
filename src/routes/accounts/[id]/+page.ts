import { error } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, params }) => {
	const [accountsResponse, accountResponse, summaryResponse, historyResponse] = await Promise.all([
		fetch('/api/accounts'),
		fetch(`/api/accounts/${params.id}`),
		fetch(`/api/accounts/${params.id}/summary`),
		fetch(`/api/accounts/${params.id}/balance-history`)
	]);

	if (!accountResponse.ok) {
		error(404, 'Account not found');
	}

	const { accounts } = (await accountsResponse.json()) as {
		accounts: Array<{ id: string; name: string; institution: string | null }>;
	};
	const { account } = (await accountResponse.json()) as {
		account: {
			id: string;
			name: string;
			institution: string | null;
			openingBalanceCents: number;
			currentBalanceCents: number | null;
		};
	};
	const { summary } = (await summaryResponse.json()) as {
		summary: {
			range: { from: string; to: string };
			totals: {
				incomeCents: number;
				expenseCents: number;
				netCents: number;
				transactionCount: number;
				unknownCount: number;
			};
			byAccount: Array<{
				accountId: string;
				accountName: string;
				balanceCents: number;
			}>;
			byCategory: Array<{
				categoryId: string | null;
				categoryName: string;
				type: string;
				expenseCents: number;
				incomeCents: number;
				netCents: number;
				transactionCount: number;
			}>;
		};
	};
	const { history } = (await historyResponse.json()) as {
		history: {
			accountId: string;
			accountName: string;
			range: { from: string; to: string };
			points: Array<{ date: string; balanceCents: number }>;
		};
	};

	return { accounts, account, summary, history };
};
