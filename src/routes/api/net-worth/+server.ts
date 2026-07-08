import { json } from '@sveltejs/kit';
import { jsonError, getRequestDatabase } from '$lib/server/api';
import { getNetWorthReport } from '$lib/server/reports/repository';
import { parseReportDateRange } from '$lib/server/reports/validation';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	try {
		const netWorth = await getNetWorthReport(
			getRequestDatabase(event),
			parseReportDateRange(event.url)
		);

		return json({ netWorth });
	} catch (error) {
		return jsonError(error);
	}
};
