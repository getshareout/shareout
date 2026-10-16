import type { ViewerScope } from '../access-policy';
import type { DataContext } from '../middleware';
import { escapeField } from './validation';
import { JSON_IN, jsonList } from '../../sql-in';

/**
 * Server-enforced row-level access clause (0042). AND-ed into every read so the
 * viewer's scope intersects whatever client filter was supplied (never widens it).
 * Empty values => deny all rows. null/undefined scope => no restriction.
 */
export function buildScopeClause(
  scope: ViewerScope | null | undefined,
): { sql: string; params: unknown[] } {
  if (!scope) return { sql: '1=1', params: [] };
  if (scope.values.length === 0) return { sql: '1=0', params: [] };
  return {
    sql: `json_extract(data, '$.${escapeField(scope.field)}') IN ${JSON_IN}`,
    params: [jsonList(scope.values)],
  };
}

/** Convenience wrapper reading scope from request context. */
export function scopeClause(ctx: DataContext): { sql: string; params: unknown[] } {
  return buildScopeClause(ctx.viewerScope);
}
