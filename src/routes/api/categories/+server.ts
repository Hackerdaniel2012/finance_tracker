import { json } from '@sveltejs/kit';
import { jsonError, getRequestDatabase, readJson } from '$lib/server/api';
import { createCategory, listCategories, updateCategory } from '$lib/server/categories/repository';
import {
	parseCreateCategoryInput,
	parseUpdateCategoryInput
} from '$lib/server/categories/validation';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const categories = await listCategories(getRequestDatabase(event));

	return json({ categories });
};

export const POST: RequestHandler = async (event) => {
	try {
		const category = await createCategory(
			getRequestDatabase(event),
			parseCreateCategoryInput(await readJson(event.request))
		);

		return json({ category }, { status: 201 });
	} catch (error) {
		return jsonError(error);
	}
};

export const PATCH: RequestHandler = async (event) => {
	try {
		const category = await updateCategory(
			getRequestDatabase(event),
			parseUpdateCategoryInput(await readJson(event.request))
		);

		return json({ category });
	} catch (error) {
		return jsonError(error);
	}
};
