import { json } from '@sveltejs/kit';
import { jsonError, getRequestDatabase } from '$lib/server/api';
import { getBalanceBeforeSalaryProjection } from '$lib/server/cashflow/repository';
import { parseCashflowWindow } from '$lib/server/cashflow/validation';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	try {
		const projection = await getBalanceBeforeSalaryProjection(
			getRequestDatabase(event),
			parseCashflowWindow(event.url)
		);

		return json({ projection });
	} catch (error) {
		return jsonError(error);
	}
};
