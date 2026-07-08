import { json } from '@sveltejs/kit';
import { jsonError, getRequestDatabase } from '$lib/server/api';
import { getUpcomingPayments } from '$lib/server/cashflow/repository';
import { parseCashflowWindow } from '$lib/server/cashflow/validation';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	try {
		const upcomingPayments = await getUpcomingPayments(
			getRequestDatabase(event),
			parseCashflowWindow(event.url)
		);

		return json({ upcomingPayments });
	} catch (error) {
		return jsonError(error);
	}
};
