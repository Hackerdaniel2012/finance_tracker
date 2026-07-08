import { json } from '@sveltejs/kit';
import { jsonError, getRequestDatabase, readJson } from '$lib/server/api';
import {
	createPlannedPayment,
	deletePlannedPayment,
	listPlannedPayments,
	updatePlannedPayment
} from '$lib/server/planned-cashflow/repository';
import {
	parseCreatePlannedPaymentInput,
	parseDeletePlannedPaymentInput,
	parseUpdatePlannedPaymentInput
} from '$lib/server/planned-cashflow/validation';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const plannedPayments = await listPlannedPayments(getRequestDatabase(event));

	return json({ plannedPayments });
};

export const POST: RequestHandler = async (event) => {
	try {
		const plannedPayment = await createPlannedPayment(
			getRequestDatabase(event),
			parseCreatePlannedPaymentInput(await readJson(event.request))
		);

		return json({ plannedPayment }, { status: 201 });
	} catch (error) {
		return jsonError(error);
	}
};

export const PATCH: RequestHandler = async (event) => {
	try {
		const plannedPayment = await updatePlannedPayment(
			getRequestDatabase(event),
			parseUpdatePlannedPaymentInput(await readJson(event.request))
		);

		return json({ plannedPayment });
	} catch (error) {
		return jsonError(error);
	}
};

export const DELETE: RequestHandler = async (event) => {
	try {
		const input = parseDeletePlannedPaymentInput(await readJson(event.request));
		await deletePlannedPayment(getRequestDatabase(event), input.id);

		return json({ ok: true });
	} catch (error) {
		return jsonError(error);
	}
};
