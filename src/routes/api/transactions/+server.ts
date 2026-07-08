import { json } from '@sveltejs/kit';
import { jsonError, getRequestDatabase } from '$lib/server/api';
import { listTransactions } from '$lib/server/transactions/repository';
import { parseTransactionFilters } from '$lib/server/transactions/validation';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	try {
		const result = await listTransactions(
			getRequestDatabase(event),
			parseTransactionFilters(event.url)
		);

		return json(result);
	} catch (error) {
		return jsonError(error);
	}
};
