import { json } from '@sveltejs/kit';
import { jsonError, getRequestDatabase } from '$lib/server/api';
import { getSummaryReport } from '$lib/server/reports/repository';
import { parseReportDateRange } from '$lib/server/reports/validation';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	try {
		const summary = await getSummaryReport(
			getRequestDatabase(event),
			parseReportDateRange(event.url),
			{ accountId: event.params.id }
		);

		return json({ summary });
	} catch (error) {
		return jsonError(error);
	}
};
