import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
	const response = await fetch('/api/accounts');
	const payload = (await response.json()) as {
		accounts: Array<{
			id: string;
			name: string;
			institution: string | null;
			balanceCents: number | null;
			balanceInitialized: boolean;
		}>;
	};
	const accounts = payload.accounts ?? [];

	return { accounts };
};
