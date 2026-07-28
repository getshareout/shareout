import { DATA_ERRORS } from '../../types';
import { errorResponse, successResponse, type DataContext } from '../middleware';
import { Errors } from '../errors';
import { MAX_QUERY_LIMIT, MAX_ROW_SIZE, MAX_ROWS_PER_TABLE } from './constants';
import { filterToSql } from './filter-sql';
import { scopeClause } from './scope';
import type { Filter, QueryBody, QueryResult } from './types';
import { escapeField } from './validation';

/**
 * Scoped read core shared by HTTP query and Crew table_query tool.
 * Viewer access scope is AND-ed here so every caller uses one enforcement path.
 */
export async function runScopedQuery(
  ctx: DataContext,
  tableName: string,
  body: QueryBody,
): Promise<QueryResult> {
  const { filter = {}, sort = {}, limit = 100, skip = 0, select, count } = body;

  const effectiveLimit = Math.min(limit, MAX_QUERY_LIMIT);
  const { sql: whereSql, params: whereParams } = filterToSql(filter);
  const scope = scopeClause(ctx);
  const allParams = [...whereParams, ...scope.params];

  // Qualify created_at to r — artifact_tables also has created_at under the JOIN.
  let orderBy = 'r.created_at DESC';
  if (Object.keys(sort).length > 0) {
    orderBy = Object.entries(sort)
      .map(([field, dir]) => `json_extract(data, '$.${escapeField(field)}') ${dir === 'desc' ? 'DESC' : 'ASC'}`)
      .join(', ');
  }

  const project = (raw: { data: string }[]): Record<string, unknown>[] => {
    let rows = raw.map((r) => JSON.parse(r.data));
    if (select && select.length > 0) {
      rows = rows.map((row: Record<string, unknown>) => {
        const projected: Record<string, unknown> = {};
        for (const field of select) {
          if (field in row) projected[field] = row[field];
        }
        return projected;
      });
    }
    return rows;
  };

  if (count === false) {
    const res = await ctx.db.prepare(
      `SELECT r.data FROM artifact_rows r JOIN artifact_tables t ON t.id = r.table_id WHERE t.artifact_id = ? AND t.name = ? AND ${whereSql} AND ${scope.sql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    ).bind(ctx.artifactId, tableName, ...allParams, effectiveLimit + 1, skip).all<{ data: string }>();
    const hasMore = res.results.length > effectiveLimit;
    const page = hasMore ? res.results.slice(0, effectiveLimit) : res.results;
    return { rows: project(page), hasMore };
  }

  const [countRes, selectRes] = await ctx.db.batch([
    {
      sql: `SELECT COUNT(*) as total FROM artifact_rows r JOIN artifact_tables t ON t.id = r.table_id WHERE t.artifact_id = ? AND t.name = ? AND ${whereSql} AND ${scope.sql}`,
      bindings: [ctx.artifactId, tableName, ...allParams],
      mode: 'first',
    },
    {
      sql: `SELECT r.data FROM artifact_rows r JOIN artifact_tables t ON t.id = r.table_id WHERE t.artifact_id = ? AND t.name = ? AND ${whereSql} AND ${scope.sql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      bindings: [ctx.artifactId, tableName, ...allParams, effectiveLimit, skip],
      mode: 'all',
    },
  ]);

  const countResult = (countRes.result ?? null) as { total: number } | null;
  const rows = project((selectRes.results ?? []) as { data: string }[]);

  return {
    rows,
    total: countResult?.total || 0,
    hasMore: skip + rows.length < (countResult?.total || 0),
  };
}

export async function queryRows(
  ctx: DataContext,
  tableName: string,
  body: QueryBody,
): Promise<Response> {
  return successResponse(await runScopedQuery(ctx, tableName, body));
}

/** Scoped query returning data (not Response) — used by Crew table_query. */
export async function queryRowsForTool(
  ctx: DataContext,
  tableName: string,
  body: QueryBody,
): Promise<QueryResult | { error: string }> {
  return runScopedQuery(ctx, tableName, body);
}

export async function countRows(
  ctx: DataContext,
  tableName: string,
  body: { filter?: Filter },
): Promise<Response> {
  const { filter = {} } = body;
  const { sql: whereSql, params: whereParams } = filterToSql(filter);
  const scope = scopeClause(ctx);

  const result = await ctx.db.prepare(
    `SELECT COUNT(*) as count FROM artifact_rows r JOIN artifact_tables t ON t.id = r.table_id WHERE t.artifact_id = ? AND t.name = ? AND ${whereSql} AND ${scope.sql}`,
  ).bind(ctx.artifactId, tableName, ...whereParams, ...scope.params).first<{ count: number }>();

  return successResponse({ count: result?.count || 0 });
}

export async function distinctValues(
  ctx: DataContext,
  tableName: string,
  body: { field: string; filter?: Filter },
): Promise<Response> {
  const { field, filter = {} } = body;

  if (!field) {
    return errorResponse(Errors.missingParam('field', 'status'), ctx.origin);
  }

  const { sql: whereSql, params: whereParams } = filterToSql(filter);
  const scope = scopeClause(ctx);

  const result = await ctx.db.prepare(
    `SELECT DISTINCT json_extract(data, '$.${escapeField(field)}') as value FROM artifact_rows r JOIN artifact_tables t ON t.id = r.table_id WHERE t.artifact_id = ? AND t.name = ? AND ${whereSql} AND ${scope.sql} ORDER BY value`,
  ).bind(ctx.artifactId, tableName, ...whereParams, ...scope.params).all<{ value: unknown }>();

  return successResponse({ values: result.results.map((r) => r.value) });
}
