import { json } from '@sveltejs/kit';
import { getRequestDatabase, jsonError, readJson } from '$lib/server/api';
import { confirmRecurringSuggestion } from '$lib/server/recurring/repository';
import { parseConfirmRecurringSuggestionInput } from '$lib/server/recurring/validation';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	try {
		const plan = await confirmRecurringSuggestion(
			getRequestDatabase(event),
			parseConfirmRecurringSuggestionInput(event.params.id, await readJson(event.request))
		);
		return json({ plan }, { status: 201 });
	} catch (error) {
		return jsonError(error);
	}
};
