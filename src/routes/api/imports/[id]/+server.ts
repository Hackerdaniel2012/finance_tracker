import { json } from '@sveltejs/kit';
import { jsonError, getRequestDatabase } from '$lib/server/api';
import { deleteImportBatch } from '$lib/server/imports/repository';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async (event) => {
	try {
		await deleteImportBatch(getRequestDatabase(event), event.params.id);

		return json({ ok: true });
	} catch (error) {
		return jsonError(error);
	}
};
