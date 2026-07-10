import { json } from '@sveltejs/kit';
import { getRequestDatabase, jsonError } from '$lib/server/api';
import { listRecurringGroups, rebuildRecurringSuggestions } from '$lib/server/recurring/repository';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const recurringGroups = await listRecurringGroups(getRequestDatabase(event));

	return json({ recurringGroups });
};

export const POST: RequestHandler = async (event) => {
	try {
		const recurringGroups = await rebuildRecurringSuggestions(getRequestDatabase(event));
		return json({ recurringGroups });
	} catch (error) {
		return jsonError(error);
	}
};
