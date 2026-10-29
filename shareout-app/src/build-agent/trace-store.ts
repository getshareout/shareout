/** Reads page_build_traces for the admin Health view. Platform admins only: the caller gates access. */
import type { Env } from '../types';
import type { BuildOutcome, BuildPath, TraceStep } from './trace';

export interface BuildTraceRow {
  id: string;
  workspace_id: string | null;
  workspace_name: string | null;
  user_id: string | null;
  source: string | null;
  path: BuildPath;
  model: string | null;
  effort: string | null;
  outcome: BuildOutcome;
  artifact_id: string | null;
  version_no: number | null;
  turns: number;
  tool_calls: number;
  tool_errors: number;
  check_rounds: number;
  verify_status: string | null;
  input_tokens: number;
  output_tokens: number;
  error_code: string | null;
  error_message: string | null;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  /** Sum of the build's model calls in ai_usage_events (0 until the hourly reconcile prices them). */
  cost_micro_usd: number;
  steps: TraceStep[];
}

type RawRow = Omit<BuildTraceRow, 'steps' | 'duration_ms'> & { steps_json: string };

function parseSteps(json: string): TraceStep[] {
  try {
    const steps = JSON.parse(json);
    return Array.isArray(steps) ? steps : [];
  } catch {
    return [];
  }
}

/**
 * Newest builds first. Cost is read from ai_usage_events: the build's own model calls are the
 * page_build rows of the same user and workspace between the build's start and finish.
 * (Two builds by one user overlapping in time share that window.)
 */
export async function getRecentBuildTraces(env: Env, limit = 25): Promise<BuildTraceRow[]> {
  const res = await env.DB.prepare(
    `SELECT t.id, t.workspace_id, w.name AS workspace_name, t.user_id, t.source, t.path, t.model, t.effort,
            t.outcome, t.artifact_id, t.version_no, t.turns, t.tool_calls, t.tool_errors, t.check_rounds,
            t.verify_status, t.input_tokens, t.output_tokens, t.error_code, t.error_message,
            t.started_at, t.finished_at, t.steps_json,
            (SELECT COALESCE(SUM(e.base_cost_micro_usd), 0) FROM ai_usage_events e
              WHERE e.kind = 'page_build' AND e.user_id IS t.user_id AND e.workspace_id IS t.workspace_id
                AND e.created_at >= t.started_at AND e.created_at <= t.finished_at) AS cost_micro_usd
       FROM page_build_traces t LEFT JOIN workspaces w ON w.id = t.workspace_id
      ORDER BY t.created_at DESC LIMIT ?`,
  ).bind(limit).all<RawRow>();
  return (res.results ?? []).map(({ steps_json, ...row }) => ({
    ...row,
    duration_ms: Math.max(0, Date.parse(row.finished_at) - Date.parse(row.started_at)),
    steps: parseSteps(steps_json),
  }));
}
