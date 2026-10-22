import type { Env } from '../../types';
import { resolveRequesterUserId, type DataContext } from '../middleware';
import { getInternalWorkspaceRole } from '../../workspaces/roles';
import { checkSlidingWindowRateLimit } from '../../rate-limit';

/** Per-user daily token cap on the in-artifact agent: generous for real crew use, a backstop against loops and scripts. */
export const MEMBER_TOKENS_PER_DAY = 300_000;

/** User id of a signed-in internal member of the artifact's workspace, else null. Members are bounded by the
 *  per-user caps below and the workspace AI budget, not the anonymous-visitor per-artifact cap. */
export async function workspaceMemberId(request: Request, ctx: DataContext): Promise<string | null> {
  if (!ctx.viewer?.email || !ctx.workspaceId) return null;
  const userId = await resolveRequesterUserId(request, ctx);
  return userId && (await getInternalWorkspaceRole(ctx.env, ctx.workspaceId, userId)) !== null ? userId : null;
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

export async function addMemberTokens(env: Env, userId: string, tokens: number): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO rate_limits (principal_type, principal_id, action, window_start, count)
    VALUES ('user', ?1, 'agent_tokens', ?2, MAX(0, ?3))
    ON CONFLICT(principal_type, principal_id, action, window_start) DO UPDATE SET count = MAX(0, count + ?3)
  `).bind(userId, new Date().toISOString().slice(0, 10), tokens).run();
}

/** Per-minute rate, workspace budget (when set), then a per-user daily token hold. A refused request holds nothing. */
export async function reserveMemberQuota(
  env: Env,
  userId: string,
  workspaceId: string,
  reservedTokens: number
): Promise<{ allowed: boolean; error?: string; retryAfter?: number }> {
  const rate = await checkSlidingWindowRateLimit(env.RATE_LIMIT_KV, `agentmember:${userId}`, 'aiChatMember');
  if (!rate.allowed) return { allowed: false, error: 'Too many AI requests. Slow down.', retryAfter: rate.retryAfter || 60 };
  if (await workspaceOverBudget(env, workspaceId)) {
    return { allowed: false, error: 'This workspace reached its monthly AI budget', retryAfter: 3600 };
  }
  await addMemberTokens(env, userId, reservedTokens);
  const row = await env.DB.prepare(
    "SELECT count FROM rate_limits WHERE principal_type = 'user' AND principal_id = ? AND action = 'agent_tokens' AND window_start = ?"
  ).bind(userId, new Date().toISOString().slice(0, 10)).first<{ count: number }>();
  if ((row?.count ?? 0) > MEMBER_TOKENS_PER_DAY) {
    await addMemberTokens(env, userId, -reservedTokens);
    const next = new Date();
    next.setUTCHours(24, 0, 0, 0);
    return { allowed: false, error: 'Daily AI limit reached for your account', retryAfter: Math.ceil((next.getTime() - Date.now()) / 1000) };
  }
  return { allowed: true };
}
