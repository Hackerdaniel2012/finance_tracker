import { json } from '@sveltejs/kit';
import { jsonError, getRequestDatabase } from '$lib/server/api';
import { getAccountBalanceHistory } from '$lib/server/reports/repository';
import { parseReportDateRange } from '$lib/server/reports/validation';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	try {
		const history = await getAccountBalanceHistory(
			getRequestDatabase(event),
			event.params.id,
			parseReportDateRange(event.url)
		);

		return json({ history });
	} catch (error) {
		return jsonError(error);
	}
};
