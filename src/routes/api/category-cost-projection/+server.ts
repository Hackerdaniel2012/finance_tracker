import { json } from '@sveltejs/kit';
import { jsonError, getRequestDatabase } from '$lib/server/api';
import { getCategoryCostProjection } from '$lib/server/cashflow/category-projection';
import { parseCategoryCostProjectionOptions } from '$lib/server/cashflow/validation';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	try {
		const projection = await getCategoryCostProjection(
			getRequestDatabase(event),
			parseCategoryCostProjectionOptions(event.url)
		);
		return json({ projection });
	} catch (error) {
		return jsonError(error);
	}
};
