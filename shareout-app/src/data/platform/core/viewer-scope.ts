// Row-level scoping for Data Platform SQL. A scoped viewer never supplies SQL: they
// name a query the author declared in `access_policy.queries`, and the server binds
// the viewer's scope into that query's SQL. Placeholders count only in code (not in
// comments or quoted text); a query with no placeholder is wrapped in a row filter on
// the policy field. Anything that cannot be scoped fails closed.
import type { RequestParams } from '../types';
import type { AccessPolicy, PolicyQuery, ScopeValue, ViewerScope } from '../../access-policy';
import {
  countPlaceholders,
  hasMultipleStatements,
  lexSql,
  replacePlaceholders,
  withoutTrailingTerminator,
} from './sql-lexer';

export const VIEWER_SCOPE_PLACEHOLDER = 'viewer_scope';

const SQL_PARAM_PATHS: ReadonlyArray<readonly [string, string]> = [
  ['body', 'sql'],
  ['body', 'query'],
  ['body', 'statement'],
  ['queryParams', 'sql'],
];

// SQL list for a scope's values (author-defined in the policy; strings escaped). An
// empty scope yields `NULL`, so `IN (NULL)` matches nothing.
export function viewerScopeSqlList(scope: ViewerScope): string {
  if (scope.values.length === 0) return 'NULL';
  return scope.values
    .map((v) => (typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`))
    .join(', ');
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

type SqlLocation = { path: readonly [string, string]; sql: string };

function sqlLocations(params: RequestParams | Record<string, unknown> | undefined): SqlLocation[] {
  const found: SqlLocation[] = [];
  for (const path of SQL_PARAM_PATHS) {
    const holder = (params as Record<string, unknown> | undefined)?.[path[0]];
    const v = holder && typeof holder === 'object' ? (holder as Record<string, unknown>)[path[1]] : undefined;
    if (typeof v === 'string') found.push({ path, sql: v });
  }
  return found;
}

function withSql(params: Record<string, unknown>, path: readonly [string, string], sql: string): RequestParams {
  const holder = { ...(params[path[0]] as Record<string, unknown>), [path[1]]: sql };
  return { ...params, [path[0]]: holder } as RequestParams;
}

export type ScopeCheck =
  | { ok: true; mode: 'placeholder' | 'wrap'; sql: string }
  | { ok: false; reason: string };

/** Validate one declared SQL string and bind `values` into it (pure). */
export function scopeSql(sql: string, field: string, values: ScopeValue[]): ScopeCheck {
  const segments = lexSql(sql);
  if (!segments) return { ok: false, reason: 'the SQL has an unterminated comment, quote or nested comment' };
  if (hasMultipleStatements(segments)) return { ok: false, reason: 'the SQL must be a single statement' };
  const list = viewerScopeSqlList({ field, values });
  if (countPlaceholders(segments, VIEWER_SCOPE_PLACEHOLDER) > 0) {
    return { ok: true, mode: 'placeholder', sql: replacePlaceholders(segments, VIEWER_SCOPE_PLACEHOLDER, list) };
  }
  if (!IDENTIFIER.test(field)) {
    return { ok: false, reason: `the policy field "${field}" is not a plain column name, so the SQL must use :viewer_scope` };
  }
  const inner = withoutTrailingTerminator(segments);
  return { ok: true, mode: 'wrap', sql: `SELECT * FROM (\n${inner}\n) AS so_scoped WHERE so_scoped.${field} IN (${list})` };
}

/** Write-time check of a declared query's params; returns an error or null. */
export function validatePolicyQuerySql(params: Record<string, unknown>, field: string): string | null {
  const locs = sqlLocations(params);
  if (locs.length !== 1) return 'params must carry exactly one SQL string (body.sql, body.query, body.statement or queryParams.sql)';
  const check = scopeSql(locs[0].sql, field, []);
  return check.ok ? null : check.reason;
}

/** Find the declared query a request names, if it matches provider, endpoint and connection. */
export function findPolicyQuery(
  policy: AccessPolicy | null | undefined,
  name: string,
  provider: string,
  endpoint: string,
  connectionId?: string,
): PolicyQuery | null {
  const q = policy?.queries && Object.prototype.hasOwnProperty.call(policy.queries, name) ? policy.queries[name] : undefined;
  if (!q) return null;
  if (q.provider !== provider || q.endpoint !== endpoint) return null;
  if (connectionId && connectionId !== q.connection) return null;
  return q;
}

/**
 * Bind a scope into a declared query's params. `scope` null = an unscoped caller
 * (owner/editor, or default-allow): placeholders get every value the policy names and
 * placeholder-free SQL runs as written.
 */
export function bindPolicyQuery(
  query: PolicyQuery,
  policy: AccessPolicy,
  scope: ViewerScope | null,
): { ok: true; params: RequestParams } | { ok: false; reason: string } {
  const locs = sqlLocations(query.params);
  if (locs.length !== 1) return { ok: false, reason: 'the declared query has no single SQL string' };
  const [{ path, sql }] = locs;
  if (scope) {
    const check = scopeSql(sql, scope.field, scope.values);
    return check.ok ? { ok: true, params: withSql(query.params, path, check.sql) } : check;
  }
  const segments = lexSql(sql);
  if (!segments || hasMultipleStatements(segments)) return { ok: false, reason: 'the declared SQL is not a single statement' };
  if (countPlaceholders(segments, VIEWER_SCOPE_PLACEHOLDER) === 0) return { ok: true, params: withSql(query.params, path, sql) };
  const all = [...new Set(policy.rules.flatMap((r) => r.values))];
  const bound = replacePlaceholders(segments, VIEWER_SCOPE_PLACEHOLDER, viewerScopeSqlList({ field: policy.field, values: all }));
  return { ok: true, params: withSql(query.params, path, bound) };
}
