import { json } from '@sveltejs/kit';
import { jsonError, getRequestDatabase, readJson } from '$lib/server/api';
import {
	createContract,
	deleteContract,
	listContracts,
	updateContract
} from '$lib/server/contracts/repository';
import {
	parseCreateContractInput,
	parseDeleteContractInput,
	parseUpdateContractInput
} from '$lib/server/contracts/validation';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const contracts = await listContracts(getRequestDatabase(event));

	return json({ contracts });
};

export const POST: RequestHandler = async (event) => {
	try {
		const contract = await createContract(
			getRequestDatabase(event),
			parseCreateContractInput(await readJson(event.request))
		);

		return json({ contract }, { status: 201 });
	} catch (error) {
		return jsonError(error);
	}
};

export const PATCH: RequestHandler = async (event) => {
	try {
		const contract = await updateContract(
			getRequestDatabase(event),
			parseUpdateContractInput(await readJson(event.request))
		);

		return json({ contract });
	} catch (error) {
		return jsonError(error);
	}
};

export const DELETE: RequestHandler = async (event) => {
	try {
		const input = parseDeleteContractInput(await readJson(event.request));
		await deleteContract(getRequestDatabase(event), input.id);

		return json({ ok: true });
	} catch (error) {
		return jsonError(error);
	}
};
