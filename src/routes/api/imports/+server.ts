import { json } from '@sveltejs/kit';
import { getRequestDatabase } from '$lib/server/api';
import { listImportBatches } from '$lib/server/imports/repository';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const imports = await listImportBatches(getRequestDatabase(event));

	return json({ imports });
};
