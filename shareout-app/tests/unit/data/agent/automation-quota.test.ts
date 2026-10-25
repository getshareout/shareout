// G17: automation (API/agent tokens, crews) bills the WORKSPACE, never a person's counter; human
// sessions keep the per-user caps; 429 bodies name the limit and when it resets.
import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetBudgetCache } from '../../../../src/data/ai-budget';
import {
  AUTOMATION_TOKENS_PER_DAY, MEMBER_TOKENS_PER_DAY, addAutomationTokens, automationTokensToday, memberTokensToday,
  reserveAgentQuota,
} from '../../../../src/data/agent/member-quota';

function fakeKv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => { m.set(k, v); } } as unknown as KVNamespace;
}
const testEnv = (kv = fakeKv()) => ({ ...env, DB: env.DB, RATE_LIMIT_KV: kv }) as never;
const member = (userId: string) => ({ kind: 'member', userId }) as const;
const automation = (userId: string) => ({ kind: 'automation', userId }) as const;

beforeAll(async () => {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS rate_limits (principal_type TEXT NOT NULL, principal_id TEXT NOT NULL, action TEXT NOT NULL, window_start TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (principal_type, principal_id, action, window_start))`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS workspace_llm_config (workspace_id TEXT PRIMARY KEY, monthly_budget_micro_usd INTEGER)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS ai_usage_events (id TEXT PRIMARY KEY, workspace_id TEXT, user_id TEXT, kind TEXT, model TEXT, units INTEGER, unit_kind TEXT, base_cost_micro_usd INTEGER, source TEXT, input_tokens INTEGER, output_tokens INTEGER, cost_source TEXT, provider_ref TEXT, created_at TEXT)`).run();
});
beforeEach(async () => {
  resetBudgetCache();
  for (const t of ['rate_limits', 'workspace_llm_config', 'ai_usage_events']) await env.DB.prepare(`DELETE FROM ${t}`).run();
});

describe('a human session keeps the per-user caps', () => {
  it('hits member_daily with a body naming the limit and an ISO reset', async () => {
    const e = testEnv();
    for (let i = 0; i < 3; i++) expect((await reserveAgentQuota(e, member('usr_a'), 'wsp_1', 100_000)).allowed).toBe(true);
    const r = await reserveAgentQuota(e, member('usr_a'), 'wsp_1', 100_000);
    expect(r).toMatchObject({ allowed: false, limit: 'member_daily' });
    expect(new Date((r as { resetsAt: string }).resetsAt).toISOString()).toBe((r as { resetsAt: string }).resetsAt);
    expect(Date.parse((r as { resetsAt: string }).resetsAt)).toBeGreaterThan(Date.now());
    expect(await memberTokensToday(e, 'usr_a')).toBe(MEMBER_TOKENS_PER_DAY);
  });

  it('hits member_rate past the per-minute window', async () => {
    const e = testEnv();
    let last: Awaited<ReturnType<typeof reserveAgentQuota>> = { allowed: true };
    for (let i = 0; i < 25; i++) last = await reserveAgentQuota(e, member('usr_r'), 'wsp_1', 1);
    expect(last).toMatchObject({ allowed: false, limit: 'member_rate' });
    expect(typeof (last as { resetsAt: string }).resetsAt).toBe('string');
  });
});

describe('automation bills the workspace and never a person', () => {
  it('a Bearer-token caller never moves the member counter', async () => {
    const e = testEnv();
    await reserveAgentQuota(e, automation('usr_leo'), 'wsp_1', 50_000);
    await addAutomationTokens(e, 'wsp_1', 1_000 - 50_000); // settle to the real usage
    expect(await memberTokensToday(e, 'usr_leo')).toBe(0);
    expect(await automationTokensToday(e, 'wsp_1')).toBe(1_000);
    const rows = await env.DB.prepare(`SELECT COUNT(*) AS n FROM rate_limits WHERE principal_type = 'user'`).first<{ n: number }>();
    expect(rows!.n).toBe(0);
  });

  it('is bounded by the workspace automation daily cap (default applies with no budget)', async () => {
    const e = testEnv();
    await addAutomationTokens(e, 'wsp_1', AUTOMATION_TOKENS_PER_DAY - 10);
    const r = await reserveAgentQuota(e, automation('usr_leo'), 'wsp_1', 100);
    expect(r).toMatchObject({ allowed: false, limit: 'workspace_automation_daily' });
    expect(AUTOMATION_TOKENS_PER_DAY).toBe(1_000_000);
    // the hold was given back, and another workspace is unaffected
    expect(await automationTokensToday(e, 'wsp_1')).toBe(AUTOMATION_TOKENS_PER_DAY - 10);
    expect((await reserveAgentQuota(e, automation('usr_leo'), 'wsp_2', 100)).allowed).toBe(true);
  });

  it('a person at their own cap can still run automation (separate budgets)', async () => {
    const e = testEnv();
    await reserveAgentQuota(e, member('usr_leo'), 'wsp_1', MEMBER_TOKENS_PER_DAY);
    expect((await reserveAgentQuota(e, member('usr_leo'), 'wsp_1', 1000)).allowed).toBe(false);
    expect((await reserveAgentQuota(e, automation('usr_leo'), 'wsp_1', 1000)).allowed).toBe(true);
  });
});

describe('the workspace budget applies to both kinds when set', () => {
  it('answers workspace_budget with a first-of-next-month reset', async () => {
    await env.DB.prepare(`INSERT INTO workspace_llm_config VALUES ('wsp_b', 100)`).run();
    await env.DB.prepare(`INSERT INTO ai_usage_events (id, workspace_id, kind, model, base_cost_micro_usd, cost_source, created_at) VALUES ('e1', 'wsp_b', 'assistant_chat', 'm', 100, 'actual', ?)`).bind(new Date().toISOString()).run();
    for (const caller of [member('usr_a'), automation('usr_a')]) {
      const r = await reserveAgentQuota(testEnv(), caller, 'wsp_b', 10);
      expect(r).toMatchObject({ allowed: false, limit: 'workspace_budget' });
      const reset = new Date((r as { resetsAt: string }).resetsAt);
      expect(reset.getUTCDate()).toBe(1);
      expect(reset.getTime()).toBeGreaterThan(Date.now());
    }
  });
});
