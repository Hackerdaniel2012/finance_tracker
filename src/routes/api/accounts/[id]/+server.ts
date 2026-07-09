import { json } from '@sveltejs/kit';
import { jsonError, getRequestDatabase } from '$lib/server/api';
import { getAccount } from '$lib/server/accounts/repository';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	try {
		const account = await getAccount(getRequestDatabase(event), event.params.id);

		if (!account) {
			return json({ error: 'Account not found' }, { status: 404 });
		}

		return json({ account });
	} catch (error) {
		return jsonError(error);
	}
};
