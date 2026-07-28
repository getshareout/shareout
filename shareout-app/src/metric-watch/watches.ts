import type { Env } from '../types';
import { generateId } from '../crypto-utils';
import { createMiniDb } from '../data/minidb-client';
import { evaluateMetric, type MetricResult } from '../metric-alerts/sources';
import { getArtifactRef, resolveAlertRole } from '../metric-alerts/access';

/**
 * One-click metric watch. A watch = artifact + table + a dead-simple metric
 * (row count / sum(column) / last value of a column). The hourly sweep reads the
 * current value from the artifact's MiniDB (reusing the audited evaluateMetric),
 * compares against the stored baseline, and drops a bell event when the value
 * moved by ≥ threshold_pct in either direction. Zero config — bell always.
 */

export type MetricKind = 'count' | 'sum' | 'last';

export interface WatchSpec {
  table: string;
  kind: MetricKind;
  /** Required for sum/last; ignored for count. */
  column?: string;
}

export interface MetricWatch {
  id: string;
  artifact_id: string;
  workspace_id: string | null;
  table_name: string;
  metric_kind: MetricKind;
  column_name: string;
  threshold_pct: number;
  last_value: number | null;
  last_checked_at: string | null;
  last_alerted_at: string | null;
  enabled: boolean;
  created_at: string;
}

const DEFAULT_THRESHOLD_PCT = 20;
const COOLDOWN_SECONDS = 6 * 3600;
const SWEEP_LIMIT = 200;
const MAX_WATCHES_PER_ARTIFACT = 20;
const METRIC_KINDS: MetricKind[] = ['count', 'sum', 'last'];

function rowToWatch(r: Record<string, unknown>): MetricWatch {
  return {
    id: r.id as string,
    artifact_id: r.artifact_id as string,
    workspace_id: (r.workspace_id as string) ?? null,
    table_name: r.table_name as string,
    metric_kind: r.metric_kind as MetricKind,
    column_name: r.column_name as string,
    threshold_pct: r.threshold_pct as number,
    last_value: (r.last_value as number) ?? null,
    last_checked_at: (r.last_checked_at as string) ?? null,
    last_alerted_at: (r.last_alerted_at as string) ?? null,
    enabled: Boolean(r.enabled),
    created_at: r.created_at as string,
  };
}

/**
 * Percent change from prev→cur. Leaving a zero baseline is an infinite move (any
 * non-zero is "meaningful") so it always trips a threshold; 0→0 is no change.
 * A null prev means "no baseline yet" and is the caller's signal to not alert.
 */
export function pctChange(prev: number, cur: number): number {
  if (prev === 0) return cur === 0 ? 0 : Infinity;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

/** Baseline-aware decision: alert only when a baseline exists and |Δ%| ≥ threshold. */
export function exceedsThreshold(prev: number | null, cur: number, thresholdPct: number): boolean {
  if (prev === null) return false;
  return Math.abs(pctChange(prev, cur)) >= thresholdPct;
}

export function validateSpec(input: unknown):
  | { ok: true; spec: WatchSpec; thresholdPct: number }
  | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'spec must be an object' };
  const o = input as Record<string, unknown>;
  const table = typeof o.table === 'string' ? o.table.trim() : '';
  if (!table) return { ok: false, error: 'table is required' };
  if (!METRIC_KINDS.includes(o.kind as MetricKind)) {
    return { ok: false, error: `kind must be one of: ${METRIC_KINDS.join(', ')}` };
  }
  const kind = o.kind as MetricKind;
  const column = typeof o.column === 'string' ? o.column.trim() : '';
  if ((kind === 'sum' || kind === 'last') && !column) {
    return { ok: false, error: `column is required for ${kind}` };
  }
  let thresholdPct = DEFAULT_THRESHOLD_PCT;
  if (o.threshold_pct !== undefined) {
    const n = Number(o.threshold_pct);
    if (!Number.isFinite(n) || n <= 0) return { ok: false, error: 'threshold_pct must be a positive number' };
    thresholdPct = n;
  }
  return { ok: true, spec: { table, kind, column: column || undefined }, thresholdPct };
}

/** Read the current metric value from the artifact's MiniDB. */
export async function readWatchValue(
  env: Env,
  artifactId: string,
  workspaceId: string | null,
  watch: { table_name: string; metric_kind: MetricKind; column_name: string }
): Promise<MetricResult> {
  const ws = workspaceId ?? '';
  if (watch.metric_kind === 'count') {
    return evaluateMetric(env, artifactId, ws, { type: 'table_count', table: watch.table_name });
  }
  if (watch.metric_kind === 'sum') {
    return evaluateMetric(env, artifactId, ws, {
      type: 'table_aggregate', table: watch.table_name, field: watch.column_name, fn: 'sum',
    });
  }
  return readLastValue(env, artifactId, ws, watch.table_name, watch.column_name);
}

/** Last value of a column = the field on the most recently added row. */
async function readLastValue(
  env: Env,
  artifactId: string,
  workspaceId: string,
  tableName: string,
  column: string
): Promise<MetricResult> {
  const db = createMiniDb(env, artifactId, workspaceId);
  const table = await db
    .prepare('SELECT id FROM artifact_tables WHERE artifact_id = ? AND name = ?')
    .bind(artifactId, tableName)
    .first<{ id: string }>();
  if (!table) return { error: `Table "${tableName}" not found` };
  const field = column.replace(/'/g, "''").replace(/\\/g, '\\\\');
  const r = await db
    .prepare(
      `SELECT CAST(json_extract(data, '$.${field}') AS REAL) AS v
         FROM artifact_rows WHERE table_id = ? ORDER BY created_at DESC LIMIT 1`
    )
    .bind(table.id)
    .first<{ v: number | null }>();
  if (!r || r.v === null) return { error: `Column "${column}" had no numeric value` };
  return { value: r.v };
}

export interface CreateWatchResult {
  watch?: MetricWatch;
  error?: string;
}

/** Owner/editor/workspace-member creates a watch. Non-members get a permission error. */
export async function createWatch(
  env: Env,
  userId: string,
  artifactId: string,
  input: unknown
): Promise<CreateWatchResult> {
  const artifact = await getArtifactRef(env, artifactId);
  if (!artifact) return { error: 'Artifact not found' };
  if (!(await resolveAlertRole(env, artifact, userId))) {
    return { error: 'Permission denied: no access to this artifact' };
  }

  const v = validateSpec(input);
  if (!v.ok) return { error: v.error };

  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM metric_watches WHERE artifact_id = ?')
    .bind(artifactId).first<{ n: number }>();
  if ((count?.n || 0) >= MAX_WATCHES_PER_ARTIFACT) {
    return { error: `Watch limit reached (${MAX_WATCHES_PER_ARTIFACT} per artifact)` };
  }

  const columnName = v.spec.column ?? '';
  // Idempotent: watching the same metric twice returns the existing watch.
  await env.DB.prepare(
    `INSERT INTO metric_watches
       (id, artifact_id, workspace_id, created_by, table_name, metric_kind, column_name, threshold_pct, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
     ON CONFLICT(artifact_id, table_name, metric_kind, column_name) DO NOTHING`
  ).bind(
    generateId('mw'), artifactId, artifact.workspace_id, userId,
    v.spec.table, v.spec.kind, columnName, v.thresholdPct
  ).run();

  const row = await env.DB.prepare(
    'SELECT * FROM metric_watches WHERE artifact_id = ? AND table_name = ? AND metric_kind = ? AND column_name = ?'
  ).bind(artifactId, v.spec.table, v.spec.kind, columnName).first<Record<string, unknown>>();
  return { watch: row ? rowToWatch(row) : undefined };
}

export async function listWatches(
  env: Env,
  userId: string,
  artifactId: string
): Promise<{ watches?: MetricWatch[]; error?: string }> {
  const artifact = await getArtifactRef(env, artifactId);
  if (!artifact) return { error: 'Artifact not found' };
  if (!(await resolveAlertRole(env, artifact, userId))) return { error: 'Permission denied' };
  const res = await env.DB.prepare('SELECT * FROM metric_watches WHERE artifact_id = ? ORDER BY created_at DESC')
    .bind(artifactId).all<Record<string, unknown>>();
  return { watches: (res.results || []).map(rowToWatch) };
}

export async function deleteWatch(
  env: Env,
  userId: string,
  watchId: string
): Promise<{ success: boolean; error?: string }> {
  const row = await env.DB.prepare('SELECT * FROM metric_watches WHERE id = ?')
    .bind(watchId).first<Record<string, unknown>>();
  if (!row) return { success: false, error: 'Watch not found' };
  const watch = rowToWatch(row);
  if (!(await resolveAlertRole(env, { id: watch.artifact_id, workspace_id: watch.workspace_id }, userId))) {
    return { success: false, error: 'Permission denied' };
  }
  await env.DB.prepare('DELETE FROM metric_watches WHERE id = ?').bind(watchId).run();
  return { success: true };
}

function metricLabel(w: { metric_kind: MetricKind; column_name: string }): string {
  if (w.metric_kind === 'count') return 'Row count';
  if (w.metric_kind === 'sum') return `sum(${w.column_name})`;
  return w.column_name;
}

/** Human alert line — no LLM. Names what moved, how much, and the direction. */
export function buildWatchMessage(
  w: { metric_kind: MetricKind; column_name: string },
  artifactName: string,
  prev: number,
  cur: number
): string {
  const label = metricLabel(w);
  if (prev === 0) return `${label} went from 0 to ${cur} on "${artifactName}".`;
  const pct = pctChange(prev, cur);
  const verb = pct >= 0 ? 'jumped' : 'dropped';
  return `${label} ${verb} ${Math.abs(Math.round(pct))}% (${prev} → ${cur}) on "${artifactName}".`;
}

/**
 * Hourly sweep: re-read each watch's metric, advance the baseline, and drop a
 * bell event when it moved ≥ threshold (honoring the 6h cooldown). Per-watch
 * failure isolation; never throws out of the scheduled handler.
 */
export async function runMetricWatchSweep(env: Env): Promise<{ alerted: number }> {
  try {
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const { results } = await env.DB.prepare(
      `SELECT w.*, a.name AS artifact_name
         FROM metric_watches w
         JOIN artifacts a ON a.id = w.artifact_id
        WHERE w.enabled = 1 AND a.deleted_at IS NULL
        LIMIT ?`
    ).bind(SWEEP_LIMIT).all<Record<string, unknown>>();

    let alerted = 0;
    for (const row of results || []) {
      try {
        const w = rowToWatch(row);
        const artifactName = (row.artifact_name as string) || 'this dashboard';
        const metric = await readWatchValue(env, w.artifact_id, w.workspace_id, w);
        if ('error' in metric) continue; // read failure: leave baseline untouched

        const cur = metric.value;
        const cooling = w.last_alerted_at !== null
          && (nowMs - Date.parse(w.last_alerted_at)) / 1000 < COOLDOWN_SECONDS;
        const shouldAlert = exceedsThreshold(w.last_value, cur, w.threshold_pct) && !cooling;

        if (shouldAlert) {
          await env.DB.batch([
            env.DB.prepare(
              `INSERT INTO notifications (id, recipient_type, recipient_id, kind, subject_type, subject_id, message, created_at)
               VALUES (?, 'artifact', ?, 'metric_watch', 'watch', ?, ?, ?)`
            ).bind(
              crypto.randomUUID(), w.artifact_id, w.id,
              buildWatchMessage(w, artifactName, w.last_value as number, cur), now
            ),
            env.DB.prepare('UPDATE metric_watches SET last_value = ?, last_checked_at = ?, last_alerted_at = ? WHERE id = ?')
              .bind(cur, now, now, w.id),
          ]);
          alerted++;
        } else {
          // Baseline drift: always advance last_value even when we don't alert.
          await env.DB.prepare('UPDATE metric_watches SET last_value = ?, last_checked_at = ? WHERE id = ?')
            .bind(cur, now, w.id).run();
        }
      } catch {
        // one watch's failure must not block the rest of the sweep
      }
    }
    return { alerted };
  } catch {
    return { alerted: 0 };
  }
}
