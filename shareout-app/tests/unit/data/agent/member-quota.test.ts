import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetBudgetCache } from '../../../../src/data/ai-budget';
import { MEMBER_TOKENS_PER_DAY, addMemberTokens, reserveMemberQuota } from '../../../../src/data/agent/member-quota';

function fakeKv() {
  const m = new Map<string, string>();
  return {
    get: async (k: string) => m.get(k) ?? null,
    put: async (k: string, v: string) => { m.set(k, v); },
  } as unknown as KVNamespace;
}

const testEnv = (kv = fakeKv()) => ({ ...env, DB: env.DB, RATE_LIMIT_KV: kv }) as never;

beforeAll(async () => {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS rate_limits (principal_type TEXT NOT NULL, principal_id TEXT NOT NULL, action TEXT NOT NULL, window_start TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (principal_type, principal_id, action, window_start))`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS workspace_llm_config (workspace_id TEXT PRIMARY KEY, monthly_budget_micro_usd INTEGER)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS ai_usage_events (id TEXT PRIMARY KEY, workspace_id TEXT, user_id TEXT, kind TEXT, model TEXT, units INTEGER, unit_kind TEXT, base_cost_micro_usd INTEGER, source TEXT, input_tokens INTEGER, output_tokens INTEGER, cost_source TEXT, provider_ref TEXT, created_at TEXT)`).run();
});
beforeEach(async () => {
  resetBudgetCache();
  for (const t of ['rate_limits', 'workspace_llm_config', 'ai_usage_events']) await env.DB.prepare(`DELETE FROM ${t}`).run();
});

describe('reserveMemberQuota', () => {
  it('with no workspace budget, allows a member until the per-user daily cap, then refuses', async () => {
    const e = testEnv();
    expect((await reserveMemberQuota(e, 'usr_a', 'wsp_1', 100_000)).allowed).toBe(true);
    expect((await reserveMemberQuota(e, 'usr_a', 'wsp_1', 100_000)).allowed).toBe(true);
    expect((await reserveMemberQuota(e, 'usr_a', 'wsp_1', 100_000)).allowed).toBe(true);
    const r = await reserveMemberQuota(e, 'usr_a', 'wsp_1', 100_000);
    expect(r.allowed).toBe(false);
    expect(r.retryAfter).toBeGreaterThan(0);
    // refused hold is given back; another user is unaffected
    expect((await reserveMemberQuota(e, 'usr_b', 'wsp_1', 100_000)).allowed).toBe(true);
    expect(MEMBER_TOKENS_PER_DAY).toBe(300_000);
  });

  it('refuses past the per-minute rate', async () => {
    const e = testEnv();
    let last = { allowed: true } as { allowed: boolean };
    for (let i = 0; i < 25; i++) last = await reserveMemberQuota(e, 'usr_r', 'wsp_1', 1);
    expect(last.allowed).toBe(false);
  });

  it('settling a smaller real usage frees budget', async () => {
    const e = testEnv();
    await reserveMemberQuota(e, 'usr_s', 'wsp_1', 290_000);
    await addMemberTokens(e, 'usr_s', 1_000 - 290_000);
    expect((await reserveMemberQuota(e, 'usr_s', 'wsp_1', 200_000)).allowed).toBe(true);
  });

  it('still enforces the workspace budget when set', async () => {
    await env.DB.prepare(`INSERT INTO workspace_llm_config VALUES ('wsp_b', 100)`).run();
    await env.DB.prepare(`INSERT INTO ai_usage_events (id, workspace_id, kind, model, base_cost_micro_usd, cost_source, created_at) VALUES ('e1', 'wsp_b', 'assistant_chat', 'm', 100, 'actual', ?)`).bind(new Date().toISOString()).run();
    const r = await reserveMemberQuota(testEnv(), 'usr_c', 'wsp_b', 10);
    expect(r.allowed).toBe(false);
  });
});
