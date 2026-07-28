// Run Inspector — one normalized shape across the three automation surfaces
// (crew, scheduled job, metric alert) so the UI renders any run with one
// component. Each fetcher verifies the run belongs to the workspace and returns
// null otherwise, so callers can map null → 404.

import type { Env } from '../types';

export type RunSurface = 'crew' | 'job' | 'alert';

export interface RunStep {
  seq: number;
  type: string;                 // event_type | step phase | 'evaluate' | 'deliver'
  label?: string;               // tool name / materialize target / destination
  status?: string;              // success | failed | running
  durationMs?: number;
  tokenInput?: number;
  tokenOutput?: number;
  input?: unknown;
  output?: unknown;
  at?: string | number;
}

export interface RunDetail {
  id: string;
  surface: RunSurface;
  source?: string;              // crew / job / rule name for the drawer title
  status: string;               // done | error | success | failed | running
  trigger?: string;
  model?: string;
  rerunPath?: string;           // POST here to re-run (job / alert); absent for crew
  startedAt?: string | number;
  endedAt?: string | number;
  durationMs?: number;
  tokenInput?: number;
  tokenOutput?: number;
  costMicroUsd?: number;
  steps: RunStep[];
  delivery?: { kind?: string; status?: string; detail?: unknown };
  result?: string;
  error?: string;
}

function parse(v: unknown): unknown {
  if (typeof v !== 'string' || !v) return v ?? undefined;
  try { return JSON.parse(v); } catch { return v; }
}

/** `*_at` columns are TEXT ISO-8601 already; this only narrows the D1 `unknown`. */
function isoOrUndefined(at: unknown): string | undefined {
  return typeof at === 'string' && at ? at : undefined;
}

async function crewRunDetail(env: Env, workspaceId: string, runId: string): Promise<RunDetail | null> {
  const run = await env.DB.prepare(
    `SELECT r.*, c.model AS crew_model, c.name AS crew_name
       FROM crew_runs r
       JOIN artifacts a ON a.id = r.artifact_id
       LEFT JOIN crews c ON c.id = r.crew_id
      WHERE r.id = ? AND a.workspace_id = ?`
  ).bind(runId, workspaceId).first<Record<string, unknown>>();
  if (!run) return null;

  const events = await env.DB.prepare(
    `SELECT seq, event_type, tool_name, input_json, output_json,
            token_input, token_output, latency_ms, created_at
       FROM crew_run_events WHERE run_id = ? ORDER BY seq`
  ).bind(runId).all<Record<string, unknown>>();

  const steps: RunStep[] = (events.results || []).map((e) => ({
    seq: Number(e.seq),
    type: String(e.event_type),
    label: (e.tool_name as string) || undefined,
    durationMs: (e.latency_ms as number) ?? undefined,
    tokenInput: (e.token_input as number) ?? undefined,
    tokenOutput: (e.token_output as number) ?? undefined,
    input: parse(e.input_json),
    output: parse(e.output_json),
    at: e.created_at as string,
  }));

  return {
    id: String(run.id),
    surface: 'crew',
    source: (run.crew_name as string) || undefined,
    status: String(run.status),
    trigger: run.trigger_kind ? String(run.trigger_kind) : undefined,
    model: (run.crew_model as string) || undefined,
    startedAt: run.started_at as string,
    endedAt: (run.ended_at as string) || undefined,
    tokenInput: (run.token_input as number) ?? undefined,
    tokenOutput: (run.token_output as number) ?? undefined,
    costMicroUsd: (run.cost_micro_usd as number) ?? undefined,
    steps,
    result: (run.result_text as string) || undefined,
    error: run.status === 'error' ? (run.termination_reason as string) || 'error' : undefined,
  };
}

async function jobRunDetail(env: Env, workspaceId: string, logId: string): Promise<RunDetail | null> {
  const log = await env.DB.prepare(
    `SELECT l.*, sj.action, sj.schedule, sj.trigger_type, sj.event_type, sj.title, a.name AS artifact_name
       FROM job_runs l
       JOIN scheduled_jobs sj ON sj.id = l.job_id
       JOIN artifacts a ON a.id = sj.artifact_id
      WHERE l.id = ? AND a.workspace_id = ?`
  ).bind(logId, workspaceId).first<Record<string, unknown>>();
  if (!log) return null;

  const rows = await env.DB.prepare(
    `SELECT seq, step, status, duration_ms, detail_json
       FROM job_run_steps WHERE run_id = ? ORDER BY seq`
  ).bind(logId).all<Record<string, unknown>>();

  const steps: RunStep[] = (rows.results || []).map((s) => ({
    seq: Number(s.seq),
    type: String(s.step),
    label: String(s.action),
    status: String(s.status),
    durationMs: (s.duration_ms as number) ?? undefined,
    output: parse(s.detail_json),
  }));

  const trigger = log.trigger_type === 'event'
    ? `event: ${log.event_type}`
    : (log.schedule ? `cron: ${log.schedule}` : 'cron');

  return {
    id: String(log.id),
    surface: 'job',
    source: (log.title as string) || `${log.action} · ${log.artifact_name}`,
    status: String(log.status),
    trigger,
    rerunPath: `/v1/workspaces/${workspaceId}/schedules/${log.job_id}/run`,
    startedAt: isoOrUndefined(log.created_at),
    durationMs: (log.duration_ms as number) ?? undefined,
    steps,
    delivery: { kind: String(log.action), status: String(log.status) },
    error: (log.error as string) || undefined,
  };
}

async function alertRunDetail(env: Env, workspaceId: string, eventId: string): Promise<RunDetail | null> {
  const ev = await env.DB.prepare(
    `SELECT e.*, r.name AS rule_name, r.schedule, r.condition_json
       FROM metric_alert_runs e
       JOIN metric_alert_rules r ON r.id = e.rule_id
      WHERE e.id = ? AND r.workspace_id = ?`
  ).bind(eventId, workspaceId).first<Record<string, unknown>>();
  if (!ev) return null;

  const matched = Number(ev.matched) === 1;
  const delivered = Number(ev.delivered) === 1;
  const status = ev.error ? 'failed' : delivered ? 'delivered' : matched ? 'matched' : 'ok';

  const steps: RunStep[] = [
    {
      seq: 0,
      type: 'evaluate',
      status: ev.error && !matched ? 'failed' : 'success',
      output: { value: ev.value, threshold: ev.threshold, matched, condition: parse(ev.condition_json) },
      at: isoOrUndefined(ev.evaluated_at),
    },
  ];
  if (matched) {
    steps.push({
      seq: 1,
      type: 'deliver',
      label: (ev.destination_kind as string) || undefined,
      status: delivered ? 'success' : 'failed',
      output: parse(ev.delivery_detail),
    });
  }

  return {
    id: String(ev.id),
    surface: 'alert',
    source: (ev.rule_name as string) || undefined,
    status,
    trigger: ev.schedule ? `cron: ${ev.schedule}` : undefined,
    rerunPath: `/v1/workspaces/${workspaceId}/metric-alerts/${ev.rule_id}/run`,
    startedAt: isoOrUndefined(ev.evaluated_at),
    steps,
    delivery: matched ? { kind: (ev.destination_kind as string) || undefined, status: delivered ? 'delivered' : 'failed' } : undefined,
    result: (ev.message as string) || undefined,
    error: (ev.error as string) || undefined,
  };
}

export interface RunListItem {
  id: string;
  surface: RunSurface;
  status: string;
  source: string;               // crew / artifact / rule name
  artifactId?: string;
  trigger?: string;
  startedAt?: string | number;
  durationMs?: number;
  costMicroUsd?: number;
}

export interface RunListFilter {
  surface?: RunSurface;
  status?: 'success' | 'failed';
  limit?: number;
}

const SUCCESS = new Set(['done', 'success', 'delivered', 'ok', 'matched']);

/** Recent runs across all three surfaces for the workspace, newest first. */
export async function listWorkspaceRuns(
  env: Env,
  workspaceId: string,
  filter: RunListFilter = {},
): Promise<RunListItem[]> {
  const limit = Math.min(filter.limit ?? 50, 200);
  const want = (s: RunSurface) => !filter.surface || filter.surface === s;
  const items: RunListItem[] = [];

  if (want('crew')) {
    const r = await env.DB.prepare(
      `SELECT r.id, r.status, r.trigger_kind, r.artifact_id, r.started_at, r.cost_micro_usd,
              r.started_at AS s, r.ended_at, c.name AS crew_name
         FROM crew_runs r
         JOIN artifacts a ON a.id = r.artifact_id
         LEFT JOIN crews c ON c.id = r.crew_id
        WHERE a.workspace_id = ? ORDER BY r.started_at DESC LIMIT ?`
    ).bind(workspaceId, limit).all<Record<string, unknown>>();
    for (const x of r.results || []) {
      const ended = x.ended_at as string | null;
      items.push({
        id: String(x.id), surface: 'crew', status: String(x.status),
        source: (x.crew_name as string) || 'Crew', artifactId: x.artifact_id as string,
        trigger: x.trigger_kind ? String(x.trigger_kind) : undefined,
        startedAt: x.started_at as string,
        durationMs: ended ? Date.parse(ended) - Date.parse(String(x.started_at)) : undefined,
        costMicroUsd: (x.cost_micro_usd as number) ?? undefined,
      });
    }
  }

  if (want('job')) {
    const r = await env.DB.prepare(
      `SELECT l.id, l.status, l.created_at, l.duration_ms, sj.action, sj.artifact_id,
              sj.title, a.name AS artifact_name
         FROM job_runs l
         JOIN scheduled_jobs sj ON sj.id = l.job_id
         JOIN artifacts a ON a.id = sj.artifact_id
        WHERE a.workspace_id = ? ORDER BY l.created_at DESC LIMIT ?`
    ).bind(workspaceId, limit).all<Record<string, unknown>>();
    for (const x of r.results || []) {
      items.push({
        id: String(x.id), surface: 'job', status: String(x.status),
        source: (x.title as string) || `${x.action} · ${x.artifact_name}`,
        artifactId: x.artifact_id as string, trigger: String(x.action),
        startedAt: isoOrUndefined(x.created_at), durationMs: (x.duration_ms as number) ?? undefined,
      });
    }
  }

  if (want('alert')) {
    const r = await env.DB.prepare(
      `SELECT e.id, e.evaluated_at, e.matched, e.delivered, e.error, e.artifact_id,
              r.name AS rule_name
         FROM metric_alert_runs e
         JOIN metric_alert_rules r ON r.id = e.rule_id
        WHERE r.workspace_id = ? ORDER BY e.evaluated_at DESC LIMIT ?`
    ).bind(workspaceId, limit).all<Record<string, unknown>>();
    for (const x of r.results || []) {
      const status = x.error ? 'failed' : Number(x.delivered) === 1 ? 'delivered' : Number(x.matched) === 1 ? 'matched' : 'ok';
      items.push({
        id: String(x.id), surface: 'alert', status,
        source: (x.rule_name as string) || 'Alert', artifactId: x.artifact_id as string,
        startedAt: isoOrUndefined(x.evaluated_at),
      });
    }
  }

  let out = items.sort((a, b) => {
    const ta = a.startedAt ? Date.parse(String(a.startedAt)) : 0;
    const tb = b.startedAt ? Date.parse(String(b.startedAt)) : 0;
    return tb - ta;
  });
  if (filter.status === 'success') out = out.filter((i) => SUCCESS.has(i.status));
  if (filter.status === 'failed') out = out.filter((i) => !SUCCESS.has(i.status));
  return out.slice(0, limit);
}

/** Fetch one run normalized to RunDetail, scoped to the workspace. null = not found. */
export async function getRunDetail(
  env: Env,
  workspaceId: string,
  surface: RunSurface,
  runId: string,
): Promise<RunDetail | null> {
  switch (surface) {
    case 'crew': return crewRunDetail(env, workspaceId, runId);
    case 'job': return jobRunDetail(env, workspaceId, runId);
    case 'alert': return alertRunDetail(env, workspaceId, runId);
    default: return null;
  }
}
