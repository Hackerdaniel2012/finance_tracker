import { json } from '@sveltejs/kit';
import { getRequestDatabase, jsonError, readJson } from '$lib/server/api';
import { parseCreateCategoryRuleInput } from '$lib/server/categories/validation';
import { previewCategoryRule } from '$lib/server/transactions/repository';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	try {
		const rule = parseCreateCategoryRuleInput(await readJson(event.request));
		const preview = await previewCategoryRule(getRequestDatabase(event), rule);
		return json(preview);
	} catch (error) {
		return jsonError(error);
	}
};
