import { json } from '@sveltejs/kit';
import { jsonError, getRequestDatabase } from '$lib/server/api';
import { ValidationError } from '$lib/server/accounts/errors';
import { previewImport } from '$lib/server/imports/preview';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	try {
		const form = await readFormData(event.request);
		const accountId = getFormString(form, 'accountId');
		const adapterId = getFormString(form, 'adapterId');
		const combineBeforeDate = getOptionalFormString(form, 'combineBeforeDate');
		const file = form.get('file');

		if (!(file instanceof Blob)) {
			throw new ValidationError('file is required');
		}

		const preview = await previewImport(getRequestDatabase(event), {
			accountId,
			adapterId,
			csv: await file.text(),
			combineBeforeDate
		});

		return json({ preview });
	} catch (error) {
		return jsonError(error);
	}
};

async function readFormData(request: Request): Promise<FormData> {
	try {
		return await request.formData();
	} catch {
		throw new ValidationError('Request body must be multipart form data');
	}
}

function getOptionalFormString(form: FormData, field: string): string | null {
	const value = form.get(field);
	if (value === null || value === '') return null;
	if (typeof value !== 'string') throw new ValidationError(`${field} must be a string`);
	return value.trim() || null;
}

function getFormString(form: FormData, field: string): string {
	const value = form.get(field);
	if (typeof value !== 'string' || value.trim() === '') {
		throw new ValidationError(`${field} is required`);
	}

	return value;
}
