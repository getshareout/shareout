// G17: crews bill the WORKSPACE (agent_usage_events, mode 'crew') and never touch a person's agent counters.
import { env } from 'cloudflare:test';
import { beforeAll, describe, it, expect } from 'vitest';
import { createMiniDb } from '../../../src/data/minidb-client';
import { mockProvider, runEval } from '../../../src/crew/eval';
import type { CrewRow, CrewRunRow } from '../../../src/crew/types';
import type { DataContext } from '../../../src/data/middleware';

beforeAll(async () => {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, tier TEXT, disabled INTEGER)`,
    `CREATE TABLE IF NOT EXISTS plan_crew_limits (plan TEXT PRIMARY KEY, max_crews_per_artifact INTEGER, max_concurrent_runs INTEGER, default_run_budget_micro_usd INTEGER, max_iterations_cap INTEGER)`,
    `CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, workspace_id TEXT, owner_id TEXT, name TEXT, visibility TEXT)`,
    `CREATE TABLE IF NOT EXISTS crews (id TEXT PRIMARY KEY, artifact_id TEXT, workspace_id TEXT, owner_id TEXT, name TEXT,
       instructions TEXT, model TEXT, status TEXT, max_iterations INTEGER, max_tokens_per_call INTEGER,
       run_budget_micro_usd INTEGER, max_runtime_ms INTEGER, created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
    `CREATE TABLE IF NOT EXISTS crew_grants (crew_id TEXT, tool_name TEXT, mode TEXT, enabled INTEGER, approval_policy TEXT, limits_json TEXT, PRIMARY KEY (crew_id, tool_name))`,
    `CREATE TABLE IF NOT EXISTS crew_runs (id TEXT PRIMARY KEY, crew_id TEXT, artifact_id TEXT, trigger_kind TEXT, initiated_by TEXT,
       status TEXT, termination_reason TEXT, input_json TEXT, result_text TEXT, iterations INTEGER DEFAULT 0,
       token_input INTEGER DEFAULT 0, token_output INTEGER DEFAULT 0, cost_micro_usd INTEGER DEFAULT 0,
       started_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), ended_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS crew_run_events (id TEXT PRIMARY KEY, run_id TEXT, crew_id TEXT, seq INTEGER, event_type TEXT,
       tool_name TEXT, input_json TEXT, output_json TEXT, token_input INTEGER, token_output INTEGER, latency_ms INTEGER, created_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS crew_action_approvals (id TEXT PRIMARY KEY, crew_id TEXT, run_id TEXT, artifact_id TEXT, tool_name TEXT,
       input_json TEXT, status TEXT DEFAULT 'pending', result_json TEXT, decided_by TEXT, decided_at TEXT, created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
    `CREATE TABLE IF NOT EXISTS crew_triggers (id TEXT PRIMARY KEY, crew_id TEXT, artifact_id TEXT, kind TEXT, cron TEXT,
       event_type TEXT, condition_json TEXT, enabled INTEGER DEFAULT 1, next_run_at INTEGER, last_run_at INTEGER,
       created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
    `CREATE TABLE IF NOT EXISTS agent_usage_events (id TEXT PRIMARY KEY, workspace_id TEXT, artifact_id TEXT, conversation_id TEXT,
       mode TEXT, provider TEXT, model TEXT, input_tokens INTEGER, output_tokens INTEGER, base_cost_micro_usd INTEGER,
       billed_cost_micro_usd INTEGER, byo INTEGER, crew_id TEXT, run_id TEXT, trigger_kind TEXT, tool_name TEXT, created_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS workspace_llm_config (workspace_id TEXT PRIMARY KEY, byo_provider TEXT, byo_encrypted_credentials TEXT, byo_iv TEXT, balance_micro_usd INTEGER DEFAULT 0, markup_multiplier REAL DEFAULT 1, monthly_budget_micro_usd INTEGER, gateway_model TEXT)`,
    `CREATE TABLE IF NOT EXISTS rate_limits (principal_type TEXT NOT NULL, principal_id TEXT NOT NULL, action TEXT NOT NULL, window_start TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (principal_type, principal_id, action, window_start))`,
  ];
  for (const s of stmts) await env.DB.prepare(s).run();
});

describe('crew runs bill the workspace, not a person', () => {
  it('records usage against the workspace and leaves every per-user / agent_tokens counter alone', async () => {
    await env.DB.prepare(`INSERT INTO artifacts (id, workspace_id, owner_id, name) VALUES ('art_w', 'wsp_bill', 'usr_leo', 'W')`).run();
    await env.DB.prepare(`INSERT INTO crews (id, artifact_id, workspace_id, owner_id, name, instructions, model, status, max_iterations, max_tokens_per_call, run_budget_micro_usd, max_runtime_ms)
      VALUES ('crew_w', 'art_w', 'wsp_bill', 'usr_leo', 'C', 'Do it.', 'mock-model', 'active', 4, 4096, 250000, 25000)`).run();
    await env.DB.prepare(`INSERT INTO crew_runs (id, crew_id, artifact_id, trigger_kind, status) VALUES ('crun_w', 'crew_w', 'art_w', 'cron', 'running')`).run();
    const crew = (await env.DB.prepare('SELECT * FROM crews WHERE id = ?').bind('crew_w').first<CrewRow>())!;
    const run = (await env.DB.prepare('SELECT * FROM crew_runs WHERE id = ?').bind('crun_w').first<CrewRunRow>())!;
    const ownerCtx: DataContext = {
      artifactId: 'art_w', workspaceId: 'wsp_bill',
      artifact: { id: 'art_w', name: 'W', visibility: 'private', auth_method: null, workspace_id: 'wsp_bill' },
      db: createMiniDb(env as never, 'art_w', 'wsp_bill'), env: env as never, origin: null, viewerScope: null,
    };
    await runEval(env as never, { crew, run, ownerCtx, input: 'Go.', provider: mockProvider([{ text: 'done', toolCalls: [] , usage: { inputTokens: 1200, outputTokens: 300 } }]) });

    const ev = await env.DB.prepare(`SELECT workspace_id, mode, input_tokens, output_tokens FROM agent_usage_events WHERE crew_id = 'crew_w'`).all<Record<string, unknown>>();
    expect(ev.results.length).toBeGreaterThan(0);
    expect(ev.results[0]).toMatchObject({ workspace_id: 'wsp_bill', mode: 'crew', input_tokens: 1200, output_tokens: 300 });
    const counters = await env.DB.prepare(`SELECT COUNT(*) AS n FROM rate_limits WHERE action = 'agent_tokens'`).first<{ n: number }>();
    expect(counters!.n).toBe(0);
  });
});
