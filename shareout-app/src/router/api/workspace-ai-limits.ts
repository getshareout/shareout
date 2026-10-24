import type { Env } from '../../types';
import type { AuthUser } from '../../api-auth';
import { getInternalWorkspaceRole } from '../../workspaces/roles';
import { jsonWithApiErrors } from '../../http/api-error';
import {
  AUTOMATION_TOKENS_PER_DAY, MEMBER_TOKENS_PER_DAY, automationTokensToday, memberTokensToday, nextDailyReset,
} from '../../data/agent/member-quota';

/**
 * GET /v1/workspaces/{id}/ai-limits — today's in-artifact agent usage. Every member sees their own counter and the
 * workspace automation total; owners/admins also see each member. Per-member counters are per person, not per
 * workspace (the cap follows the person); automation (API/agent tokens) is the workspace's own counter.
 */
export async function handleGetWorkspaceAiLimits(env: Env, user: AuthUser, workspaceId: string): Promise<Response> {
  const role = await getInternalWorkspaceRole(env, workspaceId, user.id);
  if (role === null) return jsonWithApiErrors({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);

  const today = new Date().toISOString().slice(0, 10);
  const body: Record<string, unknown> = {
    resets_at: nextDailyReset(),
    member_daily_cap: MEMBER_TOKENS_PER_DAY,
    me: { tokens_today: await memberTokensToday(env, user.id) },
    automation: { tokens_today: await automationTokensToday(env, workspaceId), daily_cap: AUTOMATION_TOKENS_PER_DAY },
  };
  if (role === 'owner' || role === 'admin') {
    const rows = await env.DB.prepare(
      `SELECT wm.user_id, u.email, COALESCE(rl.count, 0) AS tokens_today
         FROM workspace_members wm
         JOIN users u ON u.id = wm.user_id
         LEFT JOIN rate_limits rl ON rl.principal_type = 'user' AND rl.principal_id = wm.user_id
              AND rl.action = 'agent_tokens' AND rl.window_start = ?
        WHERE wm.workspace_id = ? AND wm.member_class = 'internal'
        ORDER BY tokens_today DESC, u.email`
    ).bind(today, workspaceId).all<{ user_id: string; email: string | null; tokens_today: number }>();
    body.members = rows.results ?? [];
  }
  return jsonWithApiErrors(body, 200);
}
