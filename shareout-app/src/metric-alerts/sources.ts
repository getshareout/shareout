import type { Env } from '../types';
import { createMiniDb } from '../data/minidb-client';
import { filterToSql } from '../data/tables';
import type { MetricSource } from './types';

export type MetricResult = { value: number } | { error: string };

// Replace { "$daysAgo": N } anywhere in a filter with an ISO timestamp, so
// time-relative metrics work without app code. Mirrors crew/condition.ts.
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

// Minimal JSONPath: dotted keys and array indices ("$.a.b[0].c"). No wildcards.
function extractPath(root: unknown, path: string): unknown {
  const trimmed = path.replace(/^\$\.?/, '');
  if (!trimmed) return root;
  const parts = trimmed.match(/[^.[\]]+/g) || [];
  let cur: unknown = root;
  for (const part of parts) {
    if (cur == null) return undefined;
    const idx = /^\d+$/.test(part) ? Number(part) : part;
    cur = (cur as Record<string | number, unknown>)[idx];
  }
  return cur;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

/**
 * Evaluate a metric's current numeric value from the artifact's mini-store
 * (json/tables, ADR 28). Runs at owner scope (no row filtering) — V0 alerts
 * watch owner-authored global snapshots. Returns { value } or { error }.
 */
export async function evaluateMetric(
  env: Env,
  artifactId: string,
  workspaceId: string,
  source: MetricSource
): Promise<MetricResult> {
  const db = createMiniDb(env, artifactId, workspaceId);

  if (source.type === 'json_path') {
    const row = await db
      .prepare('SELECT value FROM artifact_json WHERE artifact_id = ? AND key = ?')
      .bind(artifactId, source.key)
      .first<{ value: string }>();
    if (!row) return { error: `JSON key "${source.key}" not found` };
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.value);
    } catch {
      return { error: `JSON key "${source.key}" is not valid JSON` };
    }
    const n = toNumber(extractPath(parsed, source.path));
    if (n === null) return { error: `Path "${source.path}" did not resolve to a number` };
    return { value: n };
  }

  // table_count / table_aggregate both resolve a table by name first.
  const table = await db
    .prepare('SELECT id FROM artifact_tables WHERE artifact_id = ? AND name = ?')
    .bind(artifactId, source.table)
    .first<{ id: string }>();
  if (!table) return { error: `Table "${source.table}" not found` };

  const where = resolveRelativeDates(source.where || {}) as Record<string, unknown>;
  const { sql: whereSql, params: whereParams } = filterToSql(where);

  if (source.type === 'table_count') {
    const r = await db
      .prepare(`SELECT COUNT(*) AS n FROM artifact_rows WHERE table_id = ? AND ${whereSql}`)
      .bind(table.id, ...whereParams)
      .first<{ n: number }>();
    return { value: r?.n ?? 0 };
  }

  // table_aggregate — sum/avg/min/max over a numeric JSON field.
  const fn = source.fn.toUpperCase();
  const field = source.field.replace(/'/g, "''").replace(/\\/g, '\\\\');
  const r = await db
    .prepare(
      `SELECT ${fn}(CAST(json_extract(data, '$.${field}') AS REAL)) AS agg
         FROM artifact_rows WHERE table_id = ? AND ${whereSql}`
    )
    .bind(table.id, ...whereParams)
    .first<{ agg: number | null }>();
  const n = toNumber(r?.agg);
  if (n === null) return { error: `Aggregate ${source.fn}(${source.field}) had no numeric rows` };
  return { value: n };
}

function compareAbsolute(n: number, op: string, v: number): boolean {
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

/**
 * Decide whether the condition is met. Percent-change ops need a prior value;
 * when none exists yet they never match (we only baseline this run).
 */
export function evaluateCondition(
  op: string,
  threshold: number,
  value: number,
  lastValue: number | null
): boolean {
  if (op === 'change_pct_gt' || op === 'change_pct_lt') {
    if (lastValue === null || lastValue === 0) return false;
    const pct = ((value - lastValue) / Math.abs(lastValue)) * 100;
    return op === 'change_pct_gt' ? pct > threshold : pct < threshold;
  }
  return compareAbsolute(value, op, threshold);
}
