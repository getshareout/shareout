import type { DataContext } from '../data/middleware';
import { filterToSql, buildScopeClause } from '../data/tables';

// A condition trigger's predicate: count rows in a table matching a filter and
// compare. Cheap (one COUNT), owner-scoped, no external calls. Optional — a
// condition trigger with no predicate is a self-scheduled agent that always runs
// when due and sets its own next wake.

export interface ConditionPredicate {
  table: string;
  where?: Record<string, unknown>;
  op: 'gt' | 'gte' | 'lt' | 'lte' | 'eq';
  value: number;
}

export interface ConditionConfig {
  predicate?: ConditionPredicate;
  cooldownSeconds?: number;
}

const COOLDOWN_MIN = 3600; // 1h (cron granularity)
const COOLDOWN_MAX = 30 * 86400; // 30 days
export const RECHECK_SECONDS = 3600; // re-check a false predicate next hour

export function clampSeconds(seconds: number | undefined, fallback = 86400): number {
  const v = typeof seconds === 'number' ? seconds : fallback;
  return Math.max(COOLDOWN_MIN, Math.min(COOLDOWN_MAX, Math.round(v)));
}

// Replace { "$daysAgo": N } anywhere in the filter with an ISO timestamp, so
// time-relative conditions ("no-reply older than 10 days") work without app code.
function resolveRelativeDates(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(resolveRelativeDates);
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (typeof o.$daysAgo === 'number') {
      return new Date(Date.now() - o.$daysAgo * 86400000).toISOString();
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) out[k] = resolveRelativeDates(v);
    return out;
  }
  return value;
}

function compare(n: number, op: string, v: number): boolean {
  switch (op) {
    case 'gt':
      return n > v;
    case 'gte':
      return n >= v;
    case 'lt':
      return n < v;
    case 'lte':
      return n <= v;
    case 'eq':
      return n === v;
    default:
      return false;
  }
}

export async function evaluateCondition(
  ctx: DataContext,
  p: ConditionPredicate
): Promise<{ matched: boolean; count: number } | { error: string }> {
  const table = await ctx.db
    .prepare('SELECT id FROM artifact_tables WHERE artifact_id = ? AND name = ?')
    .bind(ctx.artifactId, p.table)
    .first<{ id: string }>();
  if (!table) return { error: `Table "${p.table}" not found` };

  const where = resolveRelativeDates(p.where || {}) as Record<string, unknown>;
  const { sql: whereSql, params: whereParams } = filterToSql(where);
  const scope = buildScopeClause(ctx.viewerScope);

  const row = await ctx.db
    .prepare(`SELECT COUNT(*) AS n FROM artifact_rows WHERE table_id = ? AND ${whereSql} AND ${scope.sql}`)
    .bind(table.id, ...whereParams, ...scope.params)
    .first<{ n: number }>();
  const count = row?.n ?? 0;
  return { matched: compare(count, p.op, p.value), count };
}

export function validateConditionConfig(
  cfg: unknown
): { ok: true; config: ConditionConfig } | { ok: false; error: string } {
  if (!cfg || typeof cfg !== 'object') return { ok: false, error: 'condition must be an object' };
  const c = cfg as Record<string, unknown>;
  const out: ConditionConfig = {};

  if (c.cooldownSeconds != null) {
    if (typeof c.cooldownSeconds !== 'number') return { ok: false, error: 'cooldownSeconds must be a number' };
    out.cooldownSeconds = c.cooldownSeconds;
  }
  if (c.predicate != null) {
    const p = c.predicate as Record<string, unknown>;
    if (typeof p.table !== 'string') return { ok: false, error: 'predicate.table must be a string' };
    if (!['gt', 'gte', 'lt', 'lte', 'eq'].includes(p.op as string)) return { ok: false, error: 'predicate.op must be gt|gte|lt|lte|eq' };
    if (typeof p.value !== 'number') return { ok: false, error: 'predicate.value must be a number' };
    out.predicate = {
      table: p.table,
      where: (p.where as Record<string, unknown>) || undefined,
      op: p.op as ConditionPredicate['op'],
      value: p.value,
    };
  }
  return { ok: true, config: out };
}
