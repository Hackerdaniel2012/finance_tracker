import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch }) => {
	const response = await fetch('/api/accounts');
	const payload = (await response.json()) as { accounts: Array<{ id: string; name: string }> };
	const accounts = payload.accounts ?? [];
	const first = accounts[0];

	if (first) {
		redirect(307, `/accounts/${first.id}`);
	}

	return { accounts };
};
