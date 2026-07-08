export type DbValue = string | number | null;
export type DbRow = Record<string, DbValue>;

export interface DbRunResult {
	success: boolean;
	meta?: {
		changes?: number;
		last_row_id?: number;
	};
}

export interface DbAllResult<T extends DbRow> {
	results: T[];
	success: boolean;
}

export interface DbStatement {
	bind(...values: DbValue[]): DbStatement;
	all<T extends DbRow>(): Promise<DbAllResult<T>>;
	first<T extends DbRow>(): Promise<T | null>;
	run(): Promise<DbRunResult>;
}

export interface DbClient {
	prepare(sql: string): DbStatement;
}

export type D1DbClient = Pick<D1Database, 'prepare'>;
