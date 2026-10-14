import type { ProviderEndpoint, RequestParams } from '../types';

// The one endpoint every HTTP-SQL connector (Supabase, Redshift, Aurora) exposes.
// It returns { columns, rows } with rows already keyed by column name, so the
// workspace assistant, crews and artifacts all read the same shape.
export const SQL_QUERY_ENDPOINT = 'sql.query';

export const SQL_QUERY: ProviderEndpoint = {
	id: SQL_QUERY_ENDPOINT,
	method: 'POST',
	path: '/sql',
	description: 'Run one SQL statement. body: { sql, maxRows? } → { columns, rows }',
};

export const DEFAULT_MAX_ROWS = 10_000;

/** The SQL text from a request: body.sql | body.query | body.statement | a bare string. */
export function sqlFrom(params: RequestParams): string {
	const b = params.body as Record<string, unknown> | string | undefined;
	if (typeof b === 'string') return b.trim();
	const v = b?.sql ?? b?.query ?? b?.statement ?? params.queryParams?.sql;
	return typeof v === 'string' ? v.trim() : '';
}

export function maxRowsFrom(params: RequestParams): number {
	const n = Number((params.body as Record<string, unknown> | undefined)?.maxRows);
	return Number.isFinite(n) && n > 0 ? Math.min(n, DEFAULT_MAX_ROWS) : DEFAULT_MAX_ROWS;
}

export function timeoutFrom(params: RequestParams, fallbackMs: number): number {
	const n = Number((params.body as Record<string, unknown> | undefined)?.timeoutMs);
	return Number.isFinite(n) && n > 0 ? Math.min(n, 120_000) : fallbackMs;
}
