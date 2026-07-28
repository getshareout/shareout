import type { Env } from '../../types';
import type { AuthUser } from '../../api-auth';
import { getInternalWorkspaceRole } from '../../workspaces';
import { jsonWithApiErrors } from '../../http/api-error';

function json(data: unknown, status = 200): Response {
  return jsonWithApiErrors(data, status);
}

function microToUsd(micro: number): number {
  return Math.round((micro / 1_000_000) * 10000) / 10000;
}

/**
 * GET /v1/workspaces/{id}/crew-usage — crew runs × cost × tools × errors × approvals.
 * Mirrors the LLM usage endpoint (member-gated). All cost from crew_runs /
 * agent_usage_events (mode='crew'), which the runtime attributes per run.
 */
export async function handleGetWorkspaceCrewUsage(
  request: Request,
  env: Env,
  user: AuthUser,
  workspaceId: string
): Promise<Response> {
  if ((await getInternalWorkspaceRole(env, workspaceId, user.id)) === null) {
    return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }

  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 200);
  const offset = Math.max(parseInt(url.searchParams.get('offset') || '0', 10) || 0, 0);

  const runs = await env.DB.prepare(
    `SELECT cr.id, cr.crew_id, cr.artifact_id, cr.trigger_kind, cr.status, cr.termination_reason,
            cr.iterations, cr.token_input, cr.token_output, cr.cost_micro_usd, cr.started_at, cr.ended_at,
            c.name AS crew_name, a.name AS artifact_name,
            (SELECT COUNT(*) FROM crew_action_approvals ca WHERE ca.run_id = cr.id AND ca.status = 'pending') AS pending_approvals
       FROM crew_runs cr
       JOIN crews c ON c.id = cr.crew_id
       LEFT JOIN artifacts a ON a.id = cr.artifact_id
      WHERE c.workspace_id = ?
      ORDER BY cr.started_at DESC
      LIMIT ? OFFSET ?`
  ).bind(workspaceId, limit, offset).all<Record<string, unknown>>();

  const totals = await env.DB.prepare(
    `SELECT cr.trigger_kind, cr.termination_reason, COUNT(*) AS run_count,
            COALESCE(SUM(cr.token_input),0) AS input_tokens,
            COALESCE(SUM(cr.token_output),0) AS output_tokens,
            COALESCE(SUM(cr.cost_micro_usd),0) AS cost_micro_usd
       FROM crew_runs cr JOIN crews c ON c.id = cr.crew_id
      WHERE c.workspace_id = ?
      GROUP BY cr.trigger_kind, cr.termination_reason`
  ).bind(workspaceId).all<Record<string, unknown>>();

  const toolBreakdown = await env.DB.prepare(
    `SELECT tool_name, COUNT(*) AS calls
       FROM crew_run_events cre
      WHERE cre.event_type = 'tool_call' AND cre.tool_name IS NOT NULL
        AND cre.run_id IN (SELECT cr.id FROM crew_runs cr JOIN crews c ON c.id = cr.crew_id WHERE c.workspace_id = ?)
      GROUP BY tool_name ORDER BY calls DESC`
  ).bind(workspaceId).all<{ tool_name: string; calls: number }>();

  const approvalStats = await env.DB.prepare(
    `SELECT status, COUNT(*) AS n
       FROM crew_action_approvals ca
      WHERE ca.run_id IN (SELECT cr.id FROM crew_runs cr JOIN crews c ON c.id = cr.crew_id WHERE c.workspace_id = ?)
      GROUP BY status`
  ).bind(workspaceId).all<{ status: string; n: number }>();

  const grand = await env.DB.prepare(
    `SELECT COUNT(*) AS runs,
            COALESCE(SUM(cr.cost_micro_usd),0) AS cost_micro_usd,
            COALESCE(SUM(CASE WHEN cr.status='error' THEN 1 ELSE 0 END),0) AS errors
       FROM crew_runs cr JOIN crews c ON c.id = cr.crew_id WHERE c.workspace_id = ?`
  ).bind(workspaceId).first<{ runs: number; cost_micro_usd: number; errors: number }>();

  return json({
    summary: {
      runs: grand?.runs ?? 0,
      errors: grand?.errors ?? 0,
      errorRate: grand && grand.runs ? Math.round((grand.errors / grand.runs) * 1000) / 1000 : 0,
      costUsd: microToUsd(grand?.cost_micro_usd ?? 0),
    },
    runs: runs.results.map((r) => ({
      runId: r.id,
      crewId: r.crew_id,
      crewName: r.crew_name,
      artifactId: r.artifact_id,
      artifactName: r.artifact_name,
      triggerKind: r.trigger_kind,
      status: r.status,
      terminationReason: r.termination_reason,
      iterations: r.iterations,
      tokenInput: r.token_input,
      tokenOutput: r.token_output,
      costUsd: microToUsd((r.cost_micro_usd as number) || 0),
      pendingApprovals: r.pending_approvals,
      startedAt: r.started_at,
      endedAt: r.ended_at,
    })),
    totals: totals.results.map((t) => ({
      triggerKind: t.trigger_kind,
      terminationReason: t.termination_reason,
      runCount: t.run_count,
      inputTokens: t.input_tokens,
      outputTokens: t.output_tokens,
      costUsd: microToUsd((t.cost_micro_usd as number) || 0),
    })),
    toolBreakdown: toolBreakdown.results,
    approvalStats: approvalStats.results,
    limit,
    offset,
  });
}
