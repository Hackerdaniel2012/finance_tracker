import { json } from '@sveltejs/kit';
import { bankAdapters } from '$lib/banks';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
	return json({
		banks: bankAdapters.map((adapter) => ({
			id: adapter.id,
			label: adapter.label,
			status: adapter.status,
			requiredColumns: adapter.requiredColumns
		}))
	});
};
