export function getDatabase(platform: App.Platform | undefined): D1Database {
	const db = platform?.env.DB;

	if (!db) {
		throw new Error('Cloudflare D1 binding DB is not available');
	}

	return db;
}

export async function assertDatabaseReady(db: D1Database): Promise<boolean> {
	const result = await db
		.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
		.bind('accounts')
		.first<{ name: string }>();

	return result?.name === 'accounts';
}
