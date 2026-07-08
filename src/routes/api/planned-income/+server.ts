import { json } from '@sveltejs/kit';
import { jsonError, getRequestDatabase, readJson } from '$lib/server/api';
import {
	createPlannedIncome,
	deletePlannedIncome,
	listPlannedIncome,
	updatePlannedIncome
} from '$lib/server/planned-cashflow/repository';
import {
	parseCreatePlannedIncomeInput,
	parseDeletePlannedIncomeInput,
	parseUpdatePlannedIncomeInput
} from '$lib/server/planned-cashflow/validation';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const plannedIncome = await listPlannedIncome(getRequestDatabase(event));

	return json({ plannedIncome });
};

export const POST: RequestHandler = async (event) => {
	try {
		const plannedIncome = await createPlannedIncome(
			getRequestDatabase(event),
			parseCreatePlannedIncomeInput(await readJson(event.request))
		);

		return json({ plannedIncome }, { status: 201 });
	} catch (error) {
		return jsonError(error);
	}
};

export const PATCH: RequestHandler = async (event) => {
	try {
		const plannedIncome = await updatePlannedIncome(
			getRequestDatabase(event),
			parseUpdatePlannedIncomeInput(await readJson(event.request))
		);

		return json({ plannedIncome });
	} catch (error) {
		return jsonError(error);
	}
};

export const DELETE: RequestHandler = async (event) => {
	try {
		const input = parseDeletePlannedIncomeInput(await readJson(event.request));
		await deletePlannedIncome(getRequestDatabase(event), input.id);

		return json({ ok: true });
	} catch (error) {
		return jsonError(error);
	}
};
