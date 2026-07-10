import { json } from '@sveltejs/kit';
import { jsonError, getRequestDatabase } from '$lib/server/api';
import { getMonthCashflowReport } from '$lib/server/cashflow/repository';
import { parseCashflowWindow } from '$lib/server/cashflow/validation';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	try {
		const monthCashflow = await getMonthCashflowReport(
			getRequestDatabase(event),
			parseCashflowWindow(event.url)
		);

		return json({ monthCashflow });
	} catch (error) {
		return jsonError(error);
	}
};
