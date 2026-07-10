import type { Handle } from '@sveltejs/kit';
import { getTextDirection } from '$lib/paraglide/runtime';
import { paraglideMiddleware } from '$lib/paraglide/server';

const handleParaglide: Handle = ({ event, resolve }) =>
	paraglideMiddleware(event.request, ({ request, locale }) => {
		event.request = request;

		return resolve(event, {
			transformPageChunk: ({ html }) =>
				html
					.replace('%paraglide.lang%', locale)
					.replace('%paraglide.dir%', getTextDirection(locale))
		});
	});

export const handle: Handle = async (input) => {
	try {
		return await handleParaglide(input);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (
			input.event.url.pathname.startsWith('/api/') &&
			/SQLITE_BUSY|database is locked/i.test(message)
		) {
			return new Response(JSON.stringify({ error: 'Database is temporarily busy' }), {
				status: 503,
				headers: { 'content-type': 'application/json', 'retry-after': '1' }
			});
		}
		throw error;
	}
};
