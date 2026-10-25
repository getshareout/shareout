// G17: today's AI usage per member and the workspace's automation usage, over the API.
import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handleGetWorkspaceAiLimits } from '../../../src/router/api/workspace-ai-limits';
import { addAutomationTokens, addMemberTokens, AUTOMATION_TOKENS_PER_DAY, MEMBER_TOKENS_PER_DAY } from '../../../src/data/agent/member-quota';

const e = env as never;
const user = (id: string) => ({ id, email: `${id}@x.com`, username: null });

beforeAll(async () => {
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, name TEXT, username TEXT)`,
    `CREATE TABLE IF NOT EXISTS workspace_members (workspace_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, member_class TEXT NOT NULL DEFAULT 'internal', PRIMARY KEY (workspace_id, user_id))`,
    `CREATE TABLE IF NOT EXISTS rate_limits (principal_type TEXT NOT NULL, principal_id TEXT NOT NULL, action TEXT NOT NULL, window_start TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (principal_type, principal_id, action, window_start))`,
    `CREATE TABLE IF NOT EXISTS workspace_llm_config (workspace_id TEXT PRIMARY KEY, monthly_budget_micro_usd INTEGER)`,
    `CREATE TABLE IF NOT EXISTS agent_usage_events (id TEXT PRIMARY KEY, workspace_id TEXT, base_cost_micro_usd INTEGER, created_at TEXT)`,
  ]) await env.DB.exec(sql);
});
beforeEach(async () => {
  for (const t of ['users', 'workspace_members', 'rate_limits', 'workspace_llm_config', 'agent_usage_events']) await env.DB.exec(`DELETE FROM ${t}`);
  await env.DB.exec(`INSERT INTO users (id, email) VALUES ('usr_admin','usr_admin@x.com'), ('usr_m','usr_m@x.com'), ('usr_out','usr_out@x.com')`);
  await env.DB.exec(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ('wsp_1','usr_admin','admin'), ('wsp_1','usr_m','member')`);
  await addMemberTokens(e, 'usr_m', 1234);
  await addAutomationTokens(e, 'wsp_1', 5678);
});

const call = async (id: string) => handleGetWorkspaceAiLimits(e, user(id), 'wsp_1');

describe('GET /v1/workspaces/{ws}/ai-limits', () => {
  it('an admin sees every member and the workspace automation usage', async () => {
    const res = await call('usr_admin');
    expect(res.status).toBe(200);
    const b = await res.json() as { me: { tokens_today: number }; members: Array<{ user_id: string; tokens_today: number }>; automation: { tokens_today: number; daily_cap: number }; member_daily_cap: number; resets_at: string };
    expect(b.members.find((m) => m.user_id === 'usr_m')!.tokens_today).toBe(1234);
    expect(b.automation).toMatchObject({ tokens_today: 5678, daily_cap: AUTOMATION_TOKENS_PER_DAY });
    expect(b.member_daily_cap).toBe(MEMBER_TOKENS_PER_DAY);
    expect(new Date(b.resets_at).toISOString()).toBe(b.resets_at);
  });

  it('a plain member sees only their own usage plus the workspace automation total', async () => {
    const b = await (await call('usr_m')).json() as { me: { tokens_today: number }; members?: unknown; automation: { tokens_today: number } };
    expect(b.me.tokens_today).toBe(1234);
    expect(b.members).toBeUndefined();
    expect(b.automation.tokens_today).toBe(5678);
  });

  it('refuses a non-member', async () => {
    expect((await call('usr_out')).status).toBe(403);
  });
});
