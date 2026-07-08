import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';

let sqlitePromise: Promise<SqlJsStatic> | undefined;

async function getSqlite(): Promise<SqlJsStatic> {
	sqlitePromise ??= initSqlJs();
	return sqlitePromise;
}

export async function createTestDatabase(): Promise<Database> {
	const SQL = await getSqlite();
	const db = new SQL.Database();
	db.run('PRAGMA foreign_keys = ON;');
	return db;
}

export function applySql(db: Database, sql: string): void {
	db.run(sql);
}

export function tableNames(db: Database): string[] {
	const rows = db.exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
	return rows[0]?.values.map(([name]) => String(name)) ?? [];
}

export function indexNames(db: Database): string[] {
	const rows = db.exec(
		"SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name"
	);
	return rows[0]?.values.map(([name]) => String(name)) ?? [];
}

export function firstValue<T extends string | number>(db: Database, sql: string): T | undefined {
	const rows = db.exec(sql);
	return rows[0]?.values[0]?.[0] as T | undefined;
}
