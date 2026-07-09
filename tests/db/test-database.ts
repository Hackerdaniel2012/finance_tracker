import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import type {
	DbAllResult,
	DbClient,
	DbRunResult,
	DbStatement,
	DbValue
} from '../../src/lib/server/db-client';

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

export function createTestDbClient(db: Database): DbClient {
	return {
		prepare(sql) {
			return new SqlJsStatement(db, sql);
		},
		async batch(statements) {
			db.run('BEGIN');
			try {
				const results: DbRunResult[] = [];
				for (const statement of statements) {
					results.push(await statement.run());
				}
				db.run('COMMIT');
				return results;
			} catch (error) {
				db.run('ROLLBACK');
				throw error;
			}
		}
	};
}

class SqlJsStatement implements DbStatement {
	private values: DbValue[] = [];

	constructor(
		private readonly db: Database,
		private readonly sql: string
	) {}

	bind(...values: DbValue[]): DbStatement {
		this.values = values;
		return this;
	}

	async all<T extends Record<string, DbValue>>(): Promise<DbAllResult<T>> {
		const statement = this.db.prepare(this.sql);
		try {
			statement.bind(this.values);
			const results: T[] = [];
			while (statement.step()) {
				results.push(statement.getAsObject() as T);
			}

			return { results, success: true };
		} finally {
			statement.free();
		}
	}

	async first<T extends Record<string, DbValue>>(): Promise<T | null> {
		const { results } = await this.all<T>();
		return results[0] ?? null;
	}

	async run(): Promise<DbRunResult> {
		this.db.run(this.sql, this.values);
		return {
			success: true,
			meta: {
				changes: this.db.getRowsModified()
			}
		};
	}
}
