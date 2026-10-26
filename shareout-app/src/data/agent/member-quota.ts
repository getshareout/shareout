import type { Env } from '../../types';
import { resolveRequesterUserId, type DataContext } from '../middleware';
import { getInternalWorkspaceRole } from '../../workspaces/roles';
import { checkSlidingWindowRateLimit } from '../../rate-limit';
import { validateToken } from '../../api-auth';
import { workspaceOverBudget } from '../ai-budget';

// Who pays for an in-artifact agent call.
//   member      a human browser session (cookie, or the artifact access token the page embeds): per-user
//               caps (rate + daily tokens), plus the workspace monthly budget when set.
//   automation  an API/agent token (personal so_, workspace agent sot_) or any server-side caller: billed to
//               the WORKSPACE (monthly budget when set, plus a per-workspace automation daily cap that
//               always applies, so it is never unbounded). It never touches a person's counter.
// Crews do not come through here at all: they bill the workspace via agent_usage_events (see run-loop.ts).

/** Per-user daily token cap on the in-artifact agent: generous for real crew use, a backstop against loops and scripts. */
export const MEMBER_TOKENS_PER_DAY = 300_000;
/** Per-workspace daily token cap for automation (API/agent tokens). */
export const AUTOMATION_TOKENS_PER_DAY = 1_000_000;

export type AgentCaller = { kind: 'member' | 'automation'; userId: string };
export type QuotaLimit = 'member_rate' | 'member_daily' | 'workspace_budget' | 'workspace_automation_daily';
export type QuotaResult =
  | { allowed: true }
  | { allowed: false; limit: QuotaLimit; error: string; retryAfter: number; resetsAt: string };

const day = () => new Date().toISOString().slice(0, 10);

function nextUtcMidnight(): Date {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d;
}
function nextMonthStart(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}
const refused = (limit: QuotaLimit, error: string, resets: Date): QuotaResult => ({
  allowed: false, limit, error, retryAfter: Math.max(1, Math.ceil((resets.getTime() - Date.now()) / 1000)), resetsAt: resets.toISOString(),
});

/** Classify the caller of an in-artifact agent endpoint. Null = not a workspace member (anonymous path). */
export async function agentCaller(request: Request, ctx: DataContext): Promise<AgentCaller | null> {
  if (!ctx.workspaceId) return null;
  // An API/agent bearer token is automation, whoever holds it.
  if (request.headers.get('Authorization')?.startsWith('Bearer ')) {
    const apiUser = await validateToken(request, ctx.env);
    if (apiUser) {
      if (apiUser.service) return apiUser.service.workspaceId === ctx.workspaceId ? { kind: 'automation', userId: apiUser.id } : null;
      return (await getInternalWorkspaceRole(ctx.env, ctx.workspaceId, apiUser.id)) !== null ? { kind: 'automation', userId: apiUser.id } : null;
    }
  }
  // Otherwise a human: session cookie or the artifact access token carrying their email.
  if (!ctx.viewer?.email) return null;
  const userId = await resolveRequesterUserId(request, ctx);
  return userId && (await getInternalWorkspaceRole(ctx.env, ctx.workspaceId, userId)) !== null ? { kind: 'member', userId } : null;
}

async function bump(env: Env, type: 'user' | 'artifact', id: string, tokens: number): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO rate_limits (principal_type, principal_id, action, window_start, count)
    VALUES (?1, ?2, 'agent_tokens', ?3, MAX(0, ?4))
    ON CONFLICT(principal_type, principal_id, action, window_start) DO UPDATE SET count = MAX(0, count + ?4)
  `).bind(type, id, day(), tokens).run();
}
async function read(env: Env, type: 'user' | 'artifact', id: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT count FROM rate_limits WHERE principal_type = ? AND principal_id = ? AND action = 'agent_tokens' AND window_start = ?"
  ).bind(type, id, day()).first<{ count: number }>();
  return row?.count ?? 0;
}

// The rate_limits CHECK only allows 'user' | 'artifact', so a workspace's automation counter lives under an
// 'artifact' key that cannot collide with a real artifact id.
const automationKey = (workspaceId: string) => `ws-automation:${workspaceId}`;

export const addMemberTokens = (env: Env, userId: string, tokens: number) => bump(env, 'user', userId, tokens);
export const addAutomationTokens = (env: Env, workspaceId: string, tokens: number) => bump(env, 'artifact', automationKey(workspaceId), tokens);
export const memberTokensToday = (env: Env, userId: string) => read(env, 'user', userId);
export const automationTokensToday = (env: Env, workspaceId: string) => read(env, 'artifact', automationKey(workspaceId));
export const nextDailyReset = () => nextUtcMidnight().toISOString();

/**
 * Per-minute rate, workspace budget (when set), then a per-user daily token hold. A refused request holds nothing.
 * The rate check and the budget read are independent, so they run together; `defer` takes the rate counter write
 * off the response path.
 */
export async function reserveMemberQuota(
  env: Env, userId: string, workspaceId: string, reservedTokens: number, defer?: (write: Promise<unknown>) => void,
): Promise<QuotaResult> {
  const [rate, overBudget] = await Promise.all([
    checkSlidingWindowRateLimit(env.RATE_LIMIT_KV, `agentmember:${userId}`, 'aiChatMember', defer),
    workspaceOverBudget(env, workspaceId),
  ]);
  if (!rate.allowed) return refused('member_rate', 'Too many AI requests. Slow down.', new Date(Date.now() + (rate.retryAfter || 60) * 1000));
  if (overBudget) return refused('workspace_budget', 'This workspace reached its monthly AI budget', nextMonthStart());
  await addMemberTokens(env, userId, reservedTokens);
  if ((await memberTokensToday(env, userId)) > MEMBER_TOKENS_PER_DAY) {
    await addMemberTokens(env, userId, -reservedTokens);
    return refused('member_daily', 'Daily AI limit reached for your account', nextUtcMidnight());
  }
  return { allowed: true };
}

/** Workspace budget (when set), then the workspace automation daily hold. Never reads or writes a person's counter. */
export async function reserveAutomationQuota(env: Env, workspaceId: string, reservedTokens: number): Promise<QuotaResult> {
  if (await workspaceOverBudget(env, workspaceId)) return refused('workspace_budget', 'This workspace reached its monthly AI budget', nextMonthStart());
  await addAutomationTokens(env, workspaceId, reservedTokens);
  if ((await automationTokensToday(env, workspaceId)) > AUTOMATION_TOKENS_PER_DAY) {
    await addAutomationTokens(env, workspaceId, -reservedTokens);
    return refused('workspace_automation_daily', "This workspace's automation reached its daily AI limit", nextUtcMidnight());
  }
  return { allowed: true };
}

export function reserveAgentQuota(
  env: Env, caller: AgentCaller, workspaceId: string, reservedTokens: number, defer?: (write: Promise<unknown>) => void,
): Promise<QuotaResult> {
  return caller.kind === 'automation'
    ? reserveAutomationQuota(env, workspaceId, reservedTokens)
    : reserveMemberQuota(env, caller.userId, workspaceId, reservedTokens, defer);
}

/** Give back / charge the difference once the real usage is known. */
export function settleAgentTokens(env: Env, caller: AgentCaller, workspaceId: string, delta: number): Promise<void> {
  return caller.kind === 'automation' ? addAutomationTokens(env, workspaceId, delta) : addMemberTokens(env, caller.userId, delta);
}
