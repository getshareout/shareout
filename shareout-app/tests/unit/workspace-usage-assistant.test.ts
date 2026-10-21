// Assistant chat and /v1/ask turns (ai_usage_events) show up in the workspace usage ledger.
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { handleGetWorkspaceUsage } from '../../src/router/api/workspace-llm';
import type { AuthUser } from '../../src/api-auth';

beforeAll(async () => {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS workspace_members (workspace_id TEXT, user_id TEXT, role TEXT, member_class TEXT)`,
    `CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, name TEXT)`,
    `CREATE TABLE IF NOT EXISTS agent_usage_events (id TEXT PRIMARY KEY, workspace_id TEXT, artifact_id TEXT NOT NULL, conversation_id TEXT,
       mode TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0,
       output_tokens INTEGER NOT NULL DEFAULT 0, base_cost_micro_usd INTEGER NOT NULL DEFAULT 0, billed_cost_micro_usd INTEGER NOT NULL DEFAULT 0,
       byo INTEGER NOT NULL DEFAULT 0, crew_id TEXT, run_id TEXT, trigger_kind TEXT, tool_name TEXT, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS ai_usage_events (id TEXT PRIMARY KEY, workspace_id TEXT, user_id TEXT, kind TEXT NOT NULL, model TEXT NOT NULL,
       units REAL NOT NULL DEFAULT 0, unit_kind TEXT NOT NULL, base_cost_micro_usd INTEGER NOT NULL DEFAULT 0, source TEXT, input_tokens INTEGER, output_tokens INTEGER, created_at TEXT NOT NULL)`,
  ];
  for (const s of stmts) await env.DB.prepare(s).run();
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO workspace_members VALUES ('wsp_u', 'usr_u', 'member', 'internal')`),
    env.DB.prepare(`INSERT INTO artifacts VALUES ('art_u', 'Dash')`),
    env.DB.prepare(`INSERT INTO agent_usage_events (id, workspace_id, artifact_id, mode, provider, model, input_tokens, output_tokens, base_cost_micro_usd, created_at)
      VALUES ('aue_1', 'wsp_u', 'art_u', 'crew', 'vercel-gateway', 'anthropic/claude-haiku-4.5', 1383, 90, 1833, '2026-10-12T10:00:00.000Z')`),
    env.DB.prepare(`INSERT INTO ai_usage_events VALUES ('aiu_1', 'wsp_u', 'usr_u', 'assistant_chat', 'anthropic/claude-sonnet-5.5', 1208, 'tokens', 2480, 'web', NULL, NULL, '2026-10-12T11:00:00.000Z')`),
    env.DB.prepare(`INSERT INTO ai_usage_events VALUES ('aiu_2', 'wsp_u', 'usr_u', 'ask_workspace', 'anthropic/claude-sonnet-5.5', 2000, 'tokens', 4000, 'web', NULL, NULL, '2026-10-12T12:00:00.000Z')`),
    env.DB.prepare(`INSERT INTO ai_usage_events VALUES ('aiu_3', 'wsp_u', 'usr_u', 'whisper_transcribe', '@cf/whisper', 12, 'audio_seconds', 90, 'web', NULL, NULL, '2026-10-12T13:00:00.000Z')`),
  ]);
});

describe('GET /v1/workspaces/{id}/usage', () => {
  it('lists assistant turns next to agent/crew calls, newest first, and totals them', async () => {
    const res = await handleGetWorkspaceUsage(new Request('https://x/v1/workspaces/wsp_u/usage'), env as never, { id: 'usr_u' } as AuthUser, 'wsp_u');
    const body = await res.json() as { events: Array<Record<string, unknown>>; totals: Record<string, number> };

    expect(body.events.map((e) => e.id)).toEqual(['aiu_2', 'aiu_1', 'aue_1']);
    expect(body.events[0]).toMatchObject({ mode: 'ask_workspace', artifactId: null, model: 'anthropic/claude-sonnet-5.5', tokens: 2000, inputTokens: null, costUsd: 0.004 });
    expect(body.events[2]).toMatchObject({ mode: 'crew', artifactName: 'Dash', inputTokens: 1383, outputTokens: 90, tokens: 1473 });
    expect(body.totals).toEqual({ requests: 3, inputTokens: 1383, outputTokens: 90, tokens: 4681, costUsd: 0.0083 });
  });
});
