import { json } from '@sveltejs/kit';
import { jsonError, getRequestDatabase, readJson } from '$lib/server/api';
import {
	createCategoryRule,
	listCategoryRules,
	updateCategoryRule
} from '$lib/server/categories/repository';
import {
	parseCreateCategoryRuleInput,
	parseUpdateCategoryRuleInput
} from '$lib/server/categories/validation';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const rules = await listCategoryRules(getRequestDatabase(event));

	return json({ rules });
};

export const POST: RequestHandler = async (event) => {
	try {
		const rule = await createCategoryRule(
			getRequestDatabase(event),
			parseCreateCategoryRuleInput(await readJson(event.request))
		);

		return json({ rule }, { status: 201 });
	} catch (error) {
		return jsonError(error);
	}
};

export const PATCH: RequestHandler = async (event) => {
	try {
		const rule = await updateCategoryRule(
			getRequestDatabase(event),
			parseUpdateCategoryRuleInput(await readJson(event.request))
		);

		return json({ rule });
	} catch (error) {
		return jsonError(error);
	}
};
