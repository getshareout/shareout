// A crew's chosen model is the one it runs on, on the gateway and the Anthropic API alike.
import { env } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { startCrewRunStream } from '../../../src/crew/triggers';
import { crewPinnedModel } from '../../../src/crew/run-loop';
import type { CrewRow } from '../../../src/crew/types';

beforeAll(async () => {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, tier TEXT)`,
    `CREATE TABLE IF NOT EXISTS plan_crew_limits (plan TEXT PRIMARY KEY, max_crews_per_artifact INTEGER, max_concurrent_runs INTEGER,
       default_run_budget_micro_usd INTEGER, max_iterations_cap INTEGER)`,
    `CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, workspace_id TEXT, owner_id TEXT, name TEXT, visibility TEXT, auth_method TEXT)`,
    `CREATE TABLE IF NOT EXISTS crews (id TEXT PRIMARY KEY, artifact_id TEXT, workspace_id TEXT, owner_id TEXT, name TEXT,
       instructions TEXT, model TEXT, status TEXT, max_iterations INTEGER, max_tokens_per_call INTEGER,
       run_budget_micro_usd INTEGER, max_runtime_ms INTEGER, created_at TEXT, updated_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS crew_runs (id TEXT PRIMARY KEY, crew_id TEXT, artifact_id TEXT, trigger_kind TEXT, initiated_by TEXT,
       status TEXT, termination_reason TEXT, input_json TEXT, result_text TEXT, iterations INTEGER DEFAULT 0,
       token_input INTEGER DEFAULT 0, token_output INTEGER DEFAULT 0, cost_micro_usd INTEGER DEFAULT 0,
       started_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), ended_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS crew_run_events (id TEXT PRIMARY KEY, run_id TEXT, crew_id TEXT, seq INTEGER, event_type TEXT,
       tool_name TEXT, input_json TEXT, output_json TEXT, token_input INTEGER, token_output INTEGER, latency_ms INTEGER, created_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS crew_grants (crew_id TEXT, tool_name TEXT, mode TEXT, approval_policy TEXT, limits_json TEXT, enabled INTEGER)`,
    `CREATE TABLE IF NOT EXISTS workspace_llm_config (workspace_id TEXT PRIMARY KEY, byo_provider TEXT, byo_encrypted_credentials TEXT,
       byo_iv TEXT, balance_micro_usd INTEGER, markup_multiplier REAL, monthly_budget_micro_usd INTEGER, gateway_model TEXT)`,
  ];
  for (const s of stmts) await env.DB.prepare(s).run();
  await env.DB.prepare(`INSERT OR REPLACE INTO workspace_llm_config (workspace_id, gateway_model) VALUES ('wsp_cm', 'anthropic/claude-sonnet-5.5')`).run();
  await env.DB.prepare(`INSERT OR REPLACE INTO artifacts (id, workspace_id, owner_id, name) VALUES ('art_cm', 'wsp_cm', 'usr_cm', 'A')`).run();
});

afterEach(() => vi.restoreAllMocks());

const crew = (model: string) =>
  ({
    id: 'crew_cm', artifact_id: 'art_cm', workspace_id: 'wsp_cm', owner_id: 'usr_cm', name: 'C', instructions: 'go',
    model, status: 'active', max_iterations: 1, max_tokens_per_call: 100, run_budget_micro_usd: 1000, max_runtime_ms: 5000,
  }) as unknown as CrewRow;

async function modelSent(model: string, keys: Record<string, string>): Promise<string> {
  await env.DB.prepare(`DELETE FROM crew_runs`).run();
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 400 }));
  const stream = await startCrewRunStream({ ...env, ...keys } as never, crew(model), 'usr_cm');
  await new Response(stream).text();
  return JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).model;
}

describe('crew model', () => {
  it('runs a Haiku crew on Haiku through the gateway, over the workspace gateway model', async () => {
    expect(await modelSent('claude-haiku-4-5-20251001', { VERCEL_AI_GATEWAY: 'vk' })).toBe('anthropic/claude-haiku-4.5');
  });

  it('runs a Haiku crew on Haiku through the Anthropic API', async () => {
    expect(await modelSent('claude-haiku-4-5-20251001', { ANTHROPIC_API_KEY: 'sk-ant' })).toBe('claude-haiku-4-5-20251001');
  });

  it('a default-model crew keeps following the workspace gateway model', async () => {
    await env.DB.prepare(`UPDATE workspace_llm_config SET gateway_model = 'openai/gpt-5' WHERE workspace_id = 'wsp_cm'`).run();
    expect(await modelSent('claude-sonnet-5-5', { VERCEL_AI_GATEWAY: 'vk' })).toBe('openai/gpt-5');
    await env.DB.prepare(`UPDATE workspace_llm_config SET gateway_model = 'anthropic/claude-sonnet-5.5' WHERE workspace_id = 'wsp_cm'`).run();
  });

  it('pins only models ShareOut serves, and accepts the undated alias', () => {
    expect(crewPinnedModel('claude-haiku-4-5')?.gateway).toBe('anthropic/claude-haiku-4.5');
    expect(crewPinnedModel('claude-sonnet-5-5')).toBeNull();
    expect(crewPinnedModel('claude-sonnet-4-20250514')).toBeNull();
    expect(crewPinnedModel(null)).toBeNull();
  });
});
