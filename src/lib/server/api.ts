import { json, type RequestEvent } from '@sveltejs/kit';
import { getDatabase } from './db';
import type { D1DbClient } from './db-client';
import { isApiDomainError, ValidationError } from './accounts/errors';

export function getRequestDatabase(event: Pick<RequestEvent, 'platform'>): D1DbClient {
	return getDatabase(event.platform);
}

export function jsonError(error: unknown): Response {
	if (isApiDomainError(error)) {
		return json({ error: error.message }, { status: error.status });
	}

	throw error;
}

export async function readJson(request: Request): Promise<unknown> {
	try {
		return await request.json();
	} catch {
		throw new ValidationError('Request body must be valid JSON');
	}
}
