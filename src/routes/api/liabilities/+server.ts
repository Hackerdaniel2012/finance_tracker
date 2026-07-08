import { json } from '@sveltejs/kit';
import { jsonError, getRequestDatabase, readJson } from '$lib/server/api';
import {
	createLiability,
	deleteLiability,
	listLiabilities,
	updateLiability
} from '$lib/server/liabilities/repository';
import {
	parseCreateLiabilityInput,
	parseDeleteLiabilityInput,
	parseUpdateLiabilityInput
} from '$lib/server/liabilities/validation';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const liabilities = await listLiabilities(getRequestDatabase(event));

	return json({ liabilities });
};

export const POST: RequestHandler = async (event) => {
	try {
		const liability = await createLiability(
			getRequestDatabase(event),
			parseCreateLiabilityInput(await readJson(event.request))
		);

		return json({ liability }, { status: 201 });
	} catch (error) {
		return jsonError(error);
	}
};

export const PATCH: RequestHandler = async (event) => {
	try {
		const liability = await updateLiability(
			getRequestDatabase(event),
			parseUpdateLiabilityInput(await readJson(event.request))
		);

		return json({ liability });
	} catch (error) {
		return jsonError(error);
	}
};

export const DELETE: RequestHandler = async (event) => {
	try {
		const input = parseDeleteLiabilityInput(await readJson(event.request));
		await deleteLiability(getRequestDatabase(event), input.id);

		return json({ ok: true });
	} catch (error) {
		return jsonError(error);
	}
};
