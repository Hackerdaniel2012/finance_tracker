import { json } from '@sveltejs/kit';
import { jsonError, getRequestDatabase } from '$lib/server/api';
import { reclassifyTransactions } from '$lib/server/transactions/repository';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	try {
		const result = await reclassifyTransactions(getRequestDatabase(event));
		return json({ result }, { status: 200 });
	} catch (error) {
		return jsonError(error);
	}
};
