import { json } from '@sveltejs/kit';
import { getRequestDatabase } from '$lib/server/api';
import { listImportRuns } from '$lib/server/imports/repository';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const imports = await listImportRuns(getRequestDatabase(event));

	return json({ imports });
};
