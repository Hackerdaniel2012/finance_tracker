import { json } from '@sveltejs/kit';
import { jsonError, getRequestDatabase } from '$lib/server/api';
import { getSummaryReport } from '$lib/server/reports/repository';
import { parseReportDateRange, parseSummaryReportOptions } from '$lib/server/reports/validation';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	try {
		const options = parseSummaryReportOptions(event.url);
		const summary = await getSummaryReport(
			getRequestDatabase(event),
			parseReportDateRange(event.url),
			options.accountId ? options : undefined
		);

		return json({ summary });
	} catch (error) {
		return jsonError(error);
	}
};
