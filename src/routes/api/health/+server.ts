import { json } from '@sveltejs/kit';
import { appInfo } from '$lib/app-info';

export function GET() {
	return json({
		ok: true,
		app: appInfo.name,
		version: appInfo.version
	});
}
