import type { Env } from '../../types';
import { resolveRequesterUserId, type DataContext } from '../middleware';
import { getInternalWorkspaceRole } from '../../workspaces/roles';

/** A signed-in internal member of the artifact's workspace: bounded by the workspace AI budget, not the anonymous-visitor per-artifact cap. */
export async function isWorkspaceMemberRequest(request: Request, ctx: DataContext): Promise<boolean> {
  if (!ctx.viewer?.email || !ctx.workspaceId) return false;
  const userId = await resolveRequesterUserId(request, ctx);
  return !!userId && (await getInternalWorkspaceRole(ctx.env, ctx.workspaceId, userId)) !== null;
}

/** True when the workspace set a monthly AI budget and this month's agent spend has reached it. */
export async function workspaceOverBudget(env: Env, workspaceId: string): Promise<boolean> {
  const cfg = await env.DB.prepare('SELECT monthly_budget_micro_usd AS b FROM workspace_llm_config WHERE workspace_id = ?')
    .bind(workspaceId).first<{ b: number | null }>();
  if (cfg?.b == null) return false;
  const month = new Date().toISOString().slice(0, 7);
  const spent = await env.DB.prepare(
    'SELECT COALESCE(SUM(base_cost_micro_usd), 0) AS s FROM agent_usage_events WHERE workspace_id = ? AND created_at >= ?'
  ).bind(workspaceId, `${month}-01`).first<{ s: number }>();
  return (spent?.s ?? 0) >= cfg.b;
}
