import { json } from '@sveltejs/kit';
import { jsonError, getRequestDatabase } from '$lib/server/api';
import { deleteAccount, getAccount } from '$lib/server/accounts/repository';
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

export const DELETE: RequestHandler = async (event) => {
	try {
		await deleteAccount(getRequestDatabase(event), event.params.id);

		return json({ ok: true });
	} catch (error) {
		return jsonError(error);
	}
};
