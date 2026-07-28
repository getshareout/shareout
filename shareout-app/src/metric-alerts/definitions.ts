import type { Env } from '../types';
import { generateId } from '../crypto-utils';
import { getArtifactRef, resolveAlertRole } from './access';
import type { MetricDefinition, MetricSource } from './types';

const MAX_METRICS_PER_ARTIFACT = 10;

/** Validate an untrusted metric source. Returns the typed source or an error. */
export function validateSource(
  raw: unknown
): { ok: true; source: MetricSource } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'source must be an object' };
  const s = raw as Record<string, unknown>;

  if (s.type === 'json_path') {
    if (typeof s.key !== 'string' || !s.key) return { ok: false, error: 'json_path.key must be a non-empty string' };
    if (typeof s.path !== 'string' || !s.path) return { ok: false, error: 'json_path.path must be a non-empty string' };
    return { ok: true, source: { type: 'json_path', key: s.key, path: s.path } };
  }
  if (s.type === 'table_count') {
    if (typeof s.table !== 'string' || !s.table) return { ok: false, error: 'table_count.table must be a non-empty string' };
    return { ok: true, source: { type: 'table_count', table: s.table, where: asWhere(s.where) } };
  }
  if (s.type === 'table_aggregate') {
    if (typeof s.table !== 'string' || !s.table) return { ok: false, error: 'table_aggregate.table must be a non-empty string' };
    if (typeof s.field !== 'string' || !s.field) return { ok: false, error: 'table_aggregate.field must be a non-empty string' };
    if (!['sum', 'avg', 'min', 'max'].includes(s.fn as string)) {
      return { ok: false, error: 'table_aggregate.fn must be sum|avg|min|max' };
    }
    return {
      ok: true,
      source: { type: 'table_aggregate', table: s.table, field: s.field, fn: s.fn as 'sum' | 'avg' | 'min' | 'max', where: asWhere(s.where) },
    };
  }
  return { ok: false, error: 'source.type must be json_path|table_count|table_aggregate' };
}

function asWhere(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function rowToDefinition(row: Record<string, unknown>): MetricDefinition {
  return {
    id: row.id as string,
    artifact_id: row.artifact_id as string,
    workspace_id: (row.workspace_id as string) ?? null,
    metric_id: row.metric_id as string,
    label: row.label as string,
    format: (row.format as string) ?? null,
    source: JSON.parse(row.source_json as string),
    created_by: row.created_by as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

export interface UpsertDefinitionRequest {
  metric_id: string;
  label: string;
  format?: string;
  source: unknown;
}

/** Managers define followable metrics. Upserts by (artifact_id, metric_id). */
export async function upsertDefinition(
  env: Env,
  userId: string,
  artifactId: string,
  req: UpsertDefinitionRequest
): Promise<{ definition?: MetricDefinition; error?: string }> {
  const artifact = await getArtifactRef(env, artifactId);
  if (!artifact) return { error: 'Artifact not found' };

  const role = await resolveAlertRole(env, artifact, userId);
  if (role !== 'manager') return { error: 'Only owners/editors or workspace admins can define metrics' };

  if (typeof req.metric_id !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/i.test(req.metric_id)) {
    return { error: 'metric_id must be alphanumeric (letters, digits, _ or -)' };
  }
  if (typeof req.label !== 'string' || !req.label.trim()) return { error: 'label is required' };

  const sourceResult = validateSource(req.source);
  if (!sourceResult.ok) return { error: sourceResult.error };

  const written = await writeDefinition(env, {
    artifactId,
    workspaceId: artifact.workspace_id,
    metricId: req.metric_id,
    label: req.label,
    format: req.format ?? null,
    source: sourceResult.source,
    createdBy: userId,
  });
  if (!written.ok) return { error: written.reason };

  const row = await env.DB.prepare(
    'SELECT * FROM artifact_metric_definitions WHERE artifact_id = ? AND metric_id = ?'
  ).bind(artifactId, req.metric_id).first<Record<string, unknown>>();
  return { definition: row ? rowToDefinition(row) : undefined };
}

interface WriteDefinitionArgs {
  artifactId: string;
  workspaceId: string | null;
  metricId: string;
  label: string;
  format: string | null;
  source: MetricSource;
  createdBy: string;
}

/** Upsert a metric definition with no permission check. Callers gate access. */
async function writeDefinition(env: Env, a: WriteDefinitionArgs): Promise<{ ok: boolean; reason?: string }> {
  const existing = await env.DB.prepare(
    'SELECT id FROM artifact_metric_definitions WHERE artifact_id = ? AND metric_id = ?'
  ).bind(a.artifactId, a.metricId).first<{ id: string }>();

  if (!existing) {
    const count = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM artifact_metric_definitions WHERE artifact_id = ?'
    ).bind(a.artifactId).first<{ n: number }>();
    if ((count?.n || 0) >= MAX_METRICS_PER_ARTIFACT) {
      return { ok: false, reason: `Metric limit reached (${MAX_METRICS_PER_ARTIFACT} per artifact)` };
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const sourceJson = JSON.stringify(a.source);

  if (existing) {
    await env.DB.prepare(
      `UPDATE artifact_metric_definitions SET label = ?, format = ?, source_json = ?, updated_at = ? WHERE id = ?`
    ).bind(a.label, a.format, sourceJson, now, existing.id).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO artifact_metric_definitions
         (id, artifact_id, workspace_id, metric_id, label, format, source_json, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(generateId('met'), a.artifactId, a.workspaceId, a.metricId, a.label, a.format, sourceJson, a.createdBy, now, now).run();
  }
  return { ok: true };
}

const METRICS_BLOCK_RE = /<script[^>]*type=["']shareout\/metrics["'][^>]*>([\s\S]*?)<\/script>/i;

/** Extract the raw metric entries from a `<script type="shareout/metrics">` block (if any). */
export function parseMetricsBlock(html: string): Array<Record<string, unknown>> {
  const m = html.match(METRICS_BLOCK_RE);
  if (!m) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(m[1].trim());
  } catch {
    return [];
  }
  const list = Array.isArray((parsed as { metrics?: unknown })?.metrics)
    ? (parsed as { metrics: unknown[] }).metrics
    : Array.isArray(parsed)
      ? (parsed as unknown[])
      : [];
  return list.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object');
}

/**
 * Register followable metrics declared in an artifact's HTML at publish time.
 * Upsert-only (additive): metrics removed from the HTML are left in place —
 * delete them via the editor/API. Best-effort; bad entries are skipped, never
 * fails the publish.
 */
export async function syncMetricsFromHtml(
  env: Env,
  artifactId: string,
  html: string,
  ownerId: string
): Promise<{ synced: number }> {
  const raw = parseMetricsBlock(html);
  if (!raw.length) return { synced: 0 };

  const artifact = await env.DB.prepare('SELECT workspace_id FROM artifacts WHERE id = ?')
    .bind(artifactId)
    .first<{ workspace_id: string | null }>();
  const workspaceId = artifact?.workspace_id ?? null;

  let synced = 0;
  for (const item of raw) {
    const metricId = (item.id ?? item.metric_id) as unknown;
    if (typeof metricId !== 'string' || !/^[a-z0-9][a-z0-9_-]*$/i.test(metricId)) continue;
    if (typeof item.label !== 'string' || !item.label.trim()) continue;
    const sr = validateSource(item.source);
    if (!sr.ok) continue;
    const w = await writeDefinition(env, {
      artifactId,
      workspaceId,
      metricId,
      label: item.label,
      format: typeof item.format === 'string' ? item.format : null,
      source: sr.source,
      createdBy: ownerId,
    });
    if (w.ok) synced++;
  }
  return { synced };
}

/** List followable metrics for an artifact. Any user with access can read them. */
export async function listDefinitions(
  env: Env,
  userId: string,
  artifactId: string
): Promise<{ definitions?: MetricDefinition[]; error?: string }> {
  const artifact = await getArtifactRef(env, artifactId);
  if (!artifact) return { error: 'Artifact not found' };
  if (!(await resolveAlertRole(env, artifact, userId))) return { error: 'Permission denied' };

  const result = await env.DB.prepare(
    'SELECT * FROM artifact_metric_definitions WHERE artifact_id = ? ORDER BY metric_id'
  ).bind(artifactId).all<Record<string, unknown>>();
  return { definitions: (result.results || []).map(rowToDefinition) };
}

/** Cheap existence check for the viewer toolbar (does this artifact expose any followable metric?). */
export async function hasMetricDefinitions(env: Env, artifactId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT 1 FROM artifact_metric_definitions WHERE artifact_id = ? LIMIT 1'
  ).bind(artifactId).first();
  return !!row;
}

export async function getDefinition(
  env: Env,
  artifactId: string,
  metricId: string
): Promise<MetricDefinition | null> {
  const row = await env.DB.prepare(
    'SELECT * FROM artifact_metric_definitions WHERE artifact_id = ? AND metric_id = ?'
  ).bind(artifactId, metricId).first<Record<string, unknown>>();
  return row ? rowToDefinition(row) : null;
}

export async function deleteDefinition(
  env: Env,
  userId: string,
  artifactId: string,
  metricId: string
): Promise<{ success: boolean; error?: string }> {
  const artifact = await getArtifactRef(env, artifactId);
  if (!artifact) return { success: false, error: 'Artifact not found' };
  const role = await resolveAlertRole(env, artifact, userId);
  if (role !== 'manager') return { success: false, error: 'Only owners/editors or workspace admins can delete metrics' };

  await env.DB.prepare(
    'DELETE FROM artifact_metric_definitions WHERE artifact_id = ? AND metric_id = ?'
  ).bind(artifactId, metricId).run();
  return { success: true };
}
