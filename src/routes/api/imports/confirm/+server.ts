import { json } from '@sveltejs/kit';
import { jsonError, getRequestDatabase } from '$lib/server/api';
import { ValidationError } from '$lib/server/accounts/errors';
import { confirmImport } from '$lib/server/imports/confirm';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	try {
		const form = await readFormData(event.request);
		const accountId = getFormString(form, 'accountId');
		const adapterId = getFormString(form, 'adapterId');
		const expectedHash = getFormString(form, 'expectedHash');
		const file = form.get('file');

		if (!(file instanceof Blob)) {
			throw new ValidationError('file is required');
		}

		const report = await confirmImport(getRequestDatabase(event), {
			accountId,
			adapterId,
			expectedHash,
			csv: await file.text()
		});

		return json({ report }, { status: 201 });
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

function getFormString(form: FormData, field: string): string {
	const value = form.get(field);
	if (typeof value !== 'string' || value.trim() === '') {
		throw new ValidationError(`${field} is required`);
	}

	return value;
}
