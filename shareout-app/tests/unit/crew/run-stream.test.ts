// Workspace "Run now" streams the crew run as SSE instead of blocking until it ends.
import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startCrewRunStream } from '../../../src/crew/triggers';
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
  ];
  for (const s of stmts) await env.DB.prepare(s).run();
});

beforeEach(async () => {
  for (const t of ['crew_runs', 'crew_run_events', 'crews', 'artifacts']) await env.DB.prepare(`DELETE FROM ${t}`).run();
});

const crew = (status = 'active') =>
  ({
    id: 'crew_rs', artifact_id: 'art_rs', workspace_id: 'wsp_rs', owner_id: 'usr_rs', name: 'C', instructions: 'go',
    model: 'm', status, max_iterations: 2, max_tokens_per_call: 100, run_budget_micro_usd: 1000, max_runtime_ms: 5000,
  }) as unknown as CrewRow;

async function seedCrew(): Promise<void> {
  await env.DB.prepare(`INSERT INTO artifacts (id, workspace_id, owner_id, name) VALUES ('art_rs', 'wsp_rs', 'usr_rs', 'A')`).run();
  await env.DB.prepare(`INSERT INTO crews (id, artifact_id, owner_id, status) VALUES ('crew_rs', 'art_rs', 'usr_rs', 'active')`).run();
}

describe('startCrewRunStream', () => {
  it('streams run_start → done and records a manual run for the clicking user', async () => {
    await seedCrew();
    const stream = await startCrewRunStream(env as never, crew(), 'usr_clicker');
    expect(stream).not.toBeNull();

    const text = await new Response(stream).text();
    const types = text.split('\n\n').filter(Boolean).map((c) => JSON.parse(c.replace(/^data: /, '')).type);
    expect(types[0]).toBe('run_start');
    expect(types.at(-1)).toBe('done');

    const run = await env.DB.prepare(`SELECT trigger_kind, initiated_by, status FROM crew_runs WHERE crew_id = 'crew_rs'`)
      .first<{ trigger_kind: string; initiated_by: string; status: string }>();
    expect(run).toMatchObject({ trigger_kind: 'manual', initiated_by: 'usr_clicker' });
    expect(run?.status).not.toBe('running');
  });

  it('returns null for an inactive crew or an owner at the concurrency limit', async () => {
    await seedCrew();
    expect(await startCrewRunStream(env as never, crew('paused'), 'usr_clicker')).toBeNull();

    await env.DB.prepare(
      `INSERT INTO crew_runs (id, crew_id, artifact_id, trigger_kind, status) VALUES ('crun_busy', 'crew_rs', 'art_rs', 'cron', 'running')`
    ).run();
    expect(await startCrewRunStream(env as never, crew(), 'usr_clicker')).toBeNull();
  });
});
