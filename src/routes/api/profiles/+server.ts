import { json } from '@sveltejs/kit';
import { jsonError, getRequestDatabase, readJson } from '$lib/server/api';
import { createProfile, listProfiles } from '$lib/server/accounts/repository';
import { parseCreateProfileInput } from '$lib/server/accounts/validation';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const profiles = await listProfiles(getRequestDatabase(event));

	return json({ profiles });
};

export const POST: RequestHandler = async (event) => {
	try {
		const profile = await createProfile(
			getRequestDatabase(event),
			parseCreateProfileInput(await readJson(event.request))
		);

		return json({ profile }, { status: 201 });
	} catch (error) {
		return jsonError(error);
	}
};
