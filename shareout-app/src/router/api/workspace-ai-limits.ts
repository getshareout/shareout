import type { Env } from '../../types';
import type { AuthUser } from '../../api-auth';
import { getInternalWorkspaceRole } from '../../workspaces/roles';
import { jsonWithApiErrors } from '../../http/api-error';
import {
  AUTOMATION_TOKENS_PER_DAY, MEMBER_TOKENS_PER_DAY, automationTokensToday, memberTokensToday, nextDailyReset,
} from '../../data/agent/member-quota';
import { budgetState } from '../../data/ai-budget';
import { multiplier } from '../../data/ai-markup';
import { isPlatformAdmin } from '../../superadmin/auth';

/**
 * GET /v1/workspaces/{id}/ai-limits — today's in-artifact agent usage. Every member sees their own counter and the
 * workspace automation total; owners/admins also see each member and this month's spend by kind. Per-member counters are per person, not per
 * workspace (the cap follows the person); automation (API/agent tokens) is the workspace's own counter.
 * Money is at the workspace's price (cost × its AI markup); platform admins also get `operator` (cost, margin).
 */
export async function handleGetWorkspaceAiLimits(env: Env, user: AuthUser, workspaceId: string): Promise<Response> {
  const role = await getInternalWorkspaceRole(env, workspaceId, user.id);
  if (role === null) return jsonWithApiErrors({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);

  const today = new Date().toISOString().slice(0, 10);
  const isAdmin = role === 'owner' || role === 'admin';
  // Monthly AI budget: every metered call of the workspace (ai_usage_events) against workspace_llm_config.
  // `resets_at` below is the DAILY reset of the token caps; the budget resets at `budget_resets_at`.
  const month = await budgetState(env, workspaceId, { fresh: isAdmin });
  const usd = (micro: number) => Math.round(micro / 100) / 10000;
  const body: Record<string, unknown> = {
    month_spend_usd: usd(month.spentMicro),
    budget_usd: month.budgetMicro == null ? null : usd(month.budgetMicro),
    pct: month.pct,
    budget_state: month.state,
    budget_resets_at: month.resetsAt,
    resets_at: nextDailyReset(),
    member_daily_cap: MEMBER_TOKENS_PER_DAY,
    me: { tokens_today: await memberTokensToday(env, user.id) },
    automation: { tokens_today: await automationTokensToday(env, workspaceId), daily_cap: AUTOMATION_TOKENS_PER_DAY },
  };
  // Spend above is the workspace's price (cost × markup). Only the instance operator sees what it cost.
  if (!user.service && (await isPlatformAdmin(env, user.email, user.id))) {
    body.operator = { cost_usd: usd(month.costMicro), margin_usd: usd(month.spentMicro - month.costMicro), markup: multiplier(month.markupBps) };
  }
  if (isAdmin) {
    body.spend_by_kind = Object.entries(month.byKind)
      .map(([kind, micro]) => ({ kind, usd: usd(micro) }))
      .sort((a, b) => b.usd - a.usd);
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
