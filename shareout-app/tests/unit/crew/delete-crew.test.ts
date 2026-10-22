import { env } from 'cloudflare:test';
import { beforeAll, describe, it, expect } from 'vitest';
import { deleteCrew, getCrew } from '../../../src/crew/store';

beforeAll(async () => {
  for (const s of [
    `CREATE TABLE IF NOT EXISTS crews (id TEXT PRIMARY KEY, artifact_id TEXT, workspace_id TEXT, owner_id TEXT, name TEXT, instructions TEXT, model TEXT, status TEXT, max_iterations INTEGER, max_tokens_per_call INTEGER, run_budget_micro_usd INTEGER, max_runtime_ms INTEGER, created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS crew_grants (crew_id TEXT, tool_name TEXT, mode TEXT, enabled INTEGER, approval_policy TEXT, limits_json TEXT, PRIMARY KEY (crew_id, tool_name))`,
    `CREATE TABLE IF NOT EXISTS crew_runs (id TEXT PRIMARY KEY, crew_id TEXT, artifact_id TEXT, status TEXT)`,
    `CREATE TABLE IF NOT EXISTS crew_run_events (id TEXT PRIMARY KEY, run_id TEXT, crew_id TEXT)`,
    `CREATE TABLE IF NOT EXISTS crew_action_approvals (id TEXT PRIMARY KEY, crew_id TEXT, run_id TEXT, artifact_id TEXT)`,
    `CREATE TABLE IF NOT EXISTS crew_triggers (id TEXT PRIMARY KEY, crew_id TEXT, artifact_id TEXT)`,
  ]) await env.DB.prepare(s).run();
});

const count = async (t: string, col: string, v: string) =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE ${col} = ?`).bind(v).first<{ n: number }>())!.n;

describe('deleteCrew', () => {
  it('removes the crew and all rows keyed on it, leaving other crews alone', async () => {
    for (const [c, a] of [['crew_d', 'art_d'], ['crew_k', 'art_k']]) {
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO crews (id, artifact_id, owner_id, status) VALUES (?, ?, 'usr', 'active')`).bind(c, a),
        env.DB.prepare(`INSERT INTO crew_grants (crew_id, tool_name, mode, enabled) VALUES (?, 'json_get', 'read', 1)`).bind(c),
        env.DB.prepare(`INSERT INTO crew_triggers (id, crew_id, artifact_id) VALUES (?, ?, ?)`).bind(`trg_${c}`, c, a),
        env.DB.prepare(`INSERT INTO crew_runs (id, crew_id, artifact_id) VALUES (?, ?, ?)`).bind(`run_${c}`, c, a),
        env.DB.prepare(`INSERT INTO crew_run_events (id, run_id, crew_id) VALUES (?, ?, ?)`).bind(`ev_${c}`, `run_${c}`, c),
        env.DB.prepare(`INSERT INTO crew_action_approvals (id, crew_id, run_id, artifact_id) VALUES (?, ?, ?, ?)`).bind(`ap_${c}`, c, `run_${c}`, a),
      ]);
    }
    expect(await deleteCrew(env as never, 'art_d')).toBe(true);
    expect(await getCrew(env as never, 'art_d')).toBeNull();
    for (const t of ['crew_grants', 'crew_triggers', 'crew_runs', 'crew_run_events', 'crew_action_approvals']) {
      expect(await count(t, 'crew_id', 'crew_d')).toBe(0);
      expect(await count(t, 'crew_id', 'crew_k')).toBe(1);
    }
    expect(await deleteCrew(env as never, 'art_d')).toBe(false);
  });
});
