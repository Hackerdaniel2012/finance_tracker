import { json } from '@sveltejs/kit';
import { jsonError, getRequestDatabase, readJson } from '$lib/server/api';
import { updateRecurringGroup } from '$lib/server/recurring/repository';
import { parseUpdateRecurringGroupInput } from '$lib/server/recurring/validation';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async (event) => {
	try {
		const recurringGroup = await updateRecurringGroup(
			getRequestDatabase(event),
			parseUpdateRecurringGroupInput(event.params.id, await readJson(event.request))
		);

		return json({ recurringGroup });
	} catch (error) {
		return jsonError(error);
	}
};
