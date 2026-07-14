import { json } from '@sveltejs/kit';
import { jsonError, getRequestDatabase, readJson } from '$lib/server/api';
import { updateTransaction } from '$lib/server/transactions/repository';
import { parseUpdateTransactionInput } from '$lib/server/transactions/validation';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async (event) => {
	try {
		const db = getRequestDatabase(event);
		const transaction = await updateTransaction(
			db,
			parseUpdateTransactionInput(event.params.id, await readJson(event.request))
		);

		return json({
			transaction,
			classifiedCount: transaction.classifiedCount,
			bulkAppliedCount: transaction.bulkAppliedCount
		});
	} catch (error) {
		return jsonError(error);
	}
};
