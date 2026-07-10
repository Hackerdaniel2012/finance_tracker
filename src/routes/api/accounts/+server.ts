import { json } from '@sveltejs/kit';
import { jsonError, getRequestDatabase, readJson } from '$lib/server/api';
import {
	createAccount,
	deleteAccount,
	listAccounts,
	updateAccount
} from '$lib/server/accounts/repository';
import {
	parseCreateAccountInput,
	parseDeleteAccountInput,
	parseUpdateAccountInput
} from '$lib/server/accounts/validation';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const accounts = await listAccounts(getRequestDatabase(event));

	return json({ accounts });
};

export const POST: RequestHandler = async (event) => {
	try {
		const account = await createAccount(
			getRequestDatabase(event),
			parseCreateAccountInput(await readJson(event.request))
		);

		return json({ account }, { status: 201 });
	} catch (error) {
		return jsonError(error);
	}
};

export const PATCH: RequestHandler = async (event) => {
	try {
		const account = await updateAccount(
			getRequestDatabase(event),
			parseUpdateAccountInput(await readJson(event.request))
		);

		return json({ account });
	} catch (error) {
		return jsonError(error);
	}
};

export const DELETE: RequestHandler = async (event) => {
	try {
		const input = parseDeleteAccountInput(await readJson(event.request));
		await deleteAccount(getRequestDatabase(event), input.id);

		return json({ ok: true });
	} catch (error) {
		return jsonError(error);
	}
};
