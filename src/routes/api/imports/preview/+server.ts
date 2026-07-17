import { json } from '@sveltejs/kit';
import { jsonError, getRequestDatabase } from '$lib/server/api';
import { ValidationError } from '$lib/server/accounts/errors';
import { previewImport } from '$lib/server/imports/preview';
import { parseImportAccountAssignmentsJson } from '$lib/server/imports/validation';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	try {
		const form = await readFormData(event.request);
		const adapterId = getFormString(form, 'adapterId');
		const assignments = getOptionalAssignments(form);
		const file = form.get('file');

		if (!(file instanceof Blob)) {
			throw new ValidationError('file is required');
		}

		const preview = await previewImport(getRequestDatabase(event), {
			adapterId,
			assignments,
			csv: await file.text()
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

function getFormString(form: FormData, field: string): string {
	const value = form.get(field);
	if (typeof value !== 'string' || value.trim() === '') {
		throw new ValidationError(`${field} is required`);
	}

	return value;
}

function getOptionalAssignments(form: FormData) {
	const value = form.get('assignments');
	if (value === null) return undefined;
	if (typeof value !== 'string') throw new ValidationError('assignments must be JSON');
	return parseImportAccountAssignmentsJson(value);
}
