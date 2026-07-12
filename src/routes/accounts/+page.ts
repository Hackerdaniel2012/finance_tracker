import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
	const response = await fetch('/api/accounts');
	const payload = (await response.json()) as {
		accounts: Array<{
			id: string;
			name: string;
			institution: string | null;
			openingBalanceCents: number;
			currentBalanceCents: number | null;
	}>;
	};
	const accounts = payload.accounts ?? [];

	return { accounts };
};
