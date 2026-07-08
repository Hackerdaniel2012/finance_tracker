import { json } from '@sveltejs/kit';
import { getRequestDatabase } from '$lib/server/api';
import { listRecurringGroups } from '$lib/server/recurring/repository';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const recurringGroups = await listRecurringGroups(getRequestDatabase(event));

	return json({ recurringGroups });
};
