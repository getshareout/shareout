// Runtime hardening regression tests:
//  #1 reapStaleRuns — abandoned 'running' rows stop consuming a concurrency slot
//  #2 runDueCrewTriggers storm guard — a throwing trigger still advances next_run_at
//  #3a awaiting_approval — a run with queued approvals reports that, not goal_met
//  #3b reapStaleApprovals — old pending approvals expire and can't be replayed
import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { createMiniDb } from '../../../src/data/minidb-client';
import { reapStaleRuns } from '../../../src/crew/store';
import { countActiveRuns } from '../../../src/crew/limits';
import { runDueCrewTriggers, claimTrigger } from '../../../src/crew/triggers';
import { reapStaleApprovals, approveAndExecute } from '../../../src/crew/approvals';
import { mockProvider, runEval } from '../../../src/crew/eval';
import type { CrewRow, CrewRunRow, CrewTriggerRow } from '../../../src/crew/types';
import type { DataContext } from '../../../src/data/middleware';

beforeAll(async () => {
  const stmts = [
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
  ];
  for (const s of stmts) await env.DB.prepare(s).run();
});

beforeEach(async () => {
  for (const t of ['crew_runs', 'crew_triggers', 'crew_action_approvals', 'crews', 'crew_grants']) {
    await env.DB.prepare(`DELETE FROM ${t}`).run();
  }
});

describe('reapStaleRuns (#1 concurrency-slot leak)', () => {
  it('reaps a run stuck running past the staleness window and frees the slot', async () => {
    await env.DB.prepare(`INSERT INTO crews (id, artifact_id, owner_id, status) VALUES ('crew_s', 'art_s', 'usr_s', 'active')`).run();
    // Stale: started 10 minutes ago, never finalized.
    await env.DB.prepare(
      `INSERT INTO crew_runs (id, crew_id, artifact_id, trigger_kind, status, started_at)
       VALUES ('crun_stale', 'crew_s', 'art_s', 'cron', 'running', strftime('%Y-%m-%dT%H:%M:%fZ','now', '-600 seconds'))`
    ).run();

    expect(await countActiveRuns(env as never, 'usr_s')).toBe(1);

    const reaped = await reapStaleRuns(env as never);
    expect(reaped).toBe(1);
    expect(await countActiveRuns(env as never, 'usr_s')).toBe(0);

    const row = await env.DB.prepare(`SELECT status, termination_reason, ended_at FROM crew_runs WHERE id='crun_stale'`).first<{
      status: string;
      termination_reason: string;
      ended_at: string | null;
    }>();
    expect(row?.status).toBe('error');
    expect(row?.termination_reason).toBe('abandoned');
    expect(row?.ended_at).not.toBeNull();
  });

  it('leaves a freshly-started running run untouched', async () => {
    await env.DB.prepare(`INSERT INTO crews (id, artifact_id, owner_id, status) VALUES ('crew_f', 'art_f', 'usr_f', 'active')`).run();
    await env.DB.prepare(
      `INSERT INTO crew_runs (id, crew_id, artifact_id, trigger_kind, status, started_at)
       VALUES ('crun_fresh', 'crew_f', 'art_f', 'cron', 'running', strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
    ).run();

    const reaped = await reapStaleRuns(env as never);
    expect(reaped).toBe(0);
    expect(await countActiveRuns(env as never, 'usr_f')).toBe(1);
  });
});

describe('runDueCrewTriggers storm guard (#2 re-fire storm)', () => {
  it('advances next_run_at when a due trigger throws, so it stops re-firing', async () => {
    const nowMs = Date.now();
    const iso = (deltaSec: number) => new Date(nowMs + deltaSec * 1000).toISOString();
    await env.DB.prepare(`INSERT INTO crews (id, artifact_id, owner_id, status) VALUES ('crew_t', 'art_t', 'usr_t', 'active')`).run();
    // condition_json is invalid JSON → JSON.parse throws inside runConditionTrigger.
    await env.DB.prepare(
      `INSERT INTO crew_triggers (id, crew_id, artifact_id, kind, condition_json, enabled, next_run_at)
       VALUES ('ctrg_bad', 'crew_t', 'art_t', 'condition', '{not valid json', 1, ?)`
    ).bind(iso(-10)).run();

    const res = await runDueCrewTriggers(env as never);
    expect(res.failed).toBeGreaterThanOrEqual(1);

    const row = await env.DB.prepare(`SELECT next_run_at FROM crew_triggers WHERE id='ctrg_bad'`).first<{ next_run_at: string }>();
    // Backed off into the future — no longer due, so the next tick won't re-fire it.
    expect(row!.next_run_at > iso(0)).toBe(true);
  });
});

describe('reapStaleApprovals (#3b stale/zombie approvals)', () => {
  it('expires old pending approvals and blocks their replay; leaves fresh ones', async () => {
    await env.DB.prepare(`INSERT INTO crews (id, artifact_id, owner_id, status) VALUES ('crew_a', 'art_a', 'usr_a', 'active')`).run();
    await env.DB.prepare(
      `INSERT INTO crew_action_approvals (id, crew_id, run_id, artifact_id, tool_name, input_json, status, created_at)
       VALUES ('appr_old', 'crew_a', 'crun_a', 'art_a', 'email_send', '{}', 'pending', strftime('%Y-%m-%dT%H:%M:%fZ','now', '-8 days'))`
    ).run();
    await env.DB.prepare(
      `INSERT INTO crew_action_approvals (id, crew_id, run_id, artifact_id, tool_name, input_json, status, created_at)
       VALUES ('appr_new', 'crew_a', 'crun_a', 'art_a', 'email_send', '{}', 'pending', strftime('%Y-%m-%dT%H:%M:%fZ','now'))`
    ).run();

    const expired = await reapStaleApprovals(env as never);
    expect(expired).toBe(1);

    const oldRow = await env.DB.prepare(`SELECT status FROM crew_action_approvals WHERE id='appr_old'`).first<{ status: string }>();
    const newRow = await env.DB.prepare(`SELECT status FROM crew_action_approvals WHERE id='appr_new'`).first<{ status: string }>();
    expect(oldRow?.status).toBe('expired');
    expect(newRow?.status).toBe('pending');

    // The expired approval can no longer be executed (status guard is no longer 'pending').
    const res = await approveAndExecute(env as never, 'appr_old', 'usr_a');
    expect(res.status).toBe('noop');
  });
});

let n = 0;
async function seedCrew(grants: Array<{ name: string; mode: 'read' | 'write'; approval?: string }>): Promise<{
  crew: CrewRow;
  run: CrewRunRow;
  ownerCtx: DataContext;
}> {
  n++;
  const crewId = `crew_ap_${n}`;
  const artifactId = `art_ap_${n}`;
  const runId = `crun_ap_${n}`;
  await env.DB.prepare(
    `INSERT INTO crews (id, artifact_id, workspace_id, owner_id, name, instructions, model, status,
       max_iterations, max_tokens_per_call, run_budget_micro_usd, max_runtime_ms)
     VALUES (?, ?, NULL, 'usr_ap', 'Eval crew', 'Do the task.', 'mock-model', 'active', 8, 4096, 250000, 25000)`
  ).bind(crewId, artifactId).run();
  for (const g of grants) {
    await env.DB.prepare(
      `INSERT INTO crew_grants (crew_id, tool_name, mode, enabled, approval_policy, limits_json) VALUES (?, ?, ?, 1, ?, NULL)`
    ).bind(crewId, g.name, g.mode, g.approval ?? 'never').run();
  }
  await env.DB.prepare(
    `INSERT INTO crew_runs (id, crew_id, artifact_id, trigger_kind, status) VALUES (?, ?, ?, 'manual', 'running')`
  ).bind(runId, crewId, artifactId).run();
  const crew = await env.DB.prepare('SELECT * FROM crews WHERE id = ?').bind(crewId).first<CrewRow>();
  const run = await env.DB.prepare('SELECT * FROM crew_runs WHERE id = ?').bind(runId).first<CrewRunRow>();
  const ownerCtx: DataContext = {
    artifactId,
    workspaceId: '',
    artifact: { id: artifactId, name: 'Eval', visibility: 'private', auth_method: null, workspace_id: null },
    db: createMiniDb(env as never, artifactId, ''),
    env: env as never,
    origin: null,
    viewerScope: null,
  };
  return { crew: crew!, run: run!, ownerCtx };
}

describe('claimTrigger compare-and-swap (#5 double-dispatch race)', () => {
  it('only the first claimant wins; a stale claim (concurrent tick) loses', async () => {
    const nowMs = Date.now();
    const iso = (deltaSec: number) => new Date(nowMs + deltaSec * 1000).toISOString();
    const now = iso(0);
    await env.DB.prepare(
      `INSERT INTO crew_triggers (id, crew_id, artifact_id, kind, cron, enabled, next_run_at)
       VALUES ('ctrg_cas', 'crew_c', 'art_c', 'cron', '0 * * * *', 1, ?)`
    ).bind(iso(-5)).run();
    const trigger = await env.DB.prepare(`SELECT * FROM crew_triggers WHERE id='ctrg_cas'`).first<CrewTriggerRow>();

    // First heartbeat claims on the observed value → wins.
    const first = await claimTrigger(env as never, trigger!, iso(3600), now);
    expect(first).toBe(true);

    // Second heartbeat that observed the SAME original value → loses (CAS fails).
    const second = await claimTrigger(env as never, trigger!, iso(3600), now);
    expect(second).toBe(false);
  });
});

describe('no-progress circuit breaker (#8 stuck loop)', () => {
  it('terminates with error when the model loops on an ungranted tool', async () => {
    const { crew, run, ownerCtx } = await seedCrew([{ name: 'table_query', mode: 'read' }]);

    const result = await runEval(env as never, {
      crew,
      run,
      ownerCtx,
      input: 'Go.',
      // Every turn calls an ungranted tool and never finishes — pure no-progress.
      provider: mockProvider([{ toolCalls: [{ name: 'email_send', input: {} }] }]),
    });

    expect(result.terminationReason).toBe('error');
    // Broke on the streak cap, well before max_iterations (8).
    expect(result.calledTools.filter((t) => t === 'email_send').length).toBeLessThanOrEqual(3);
  });
});

describe('empty model response (#4)', () => {
  it('treats an empty no-tool turn as error, not goal_met', async () => {
    const { crew, run, ownerCtx } = await seedCrew([{ name: 'table_query', mode: 'read' }]);
    const result = await runEval(env as never, {
      crew,
      run,
      ownerCtx,
      input: 'Go.',
      provider: mockProvider([{ text: '', toolCalls: [] }]),
    });
    expect(result.terminationReason).toBe('error');
  });

  it('still treats a non-empty no-tool turn as goal_met', async () => {
    const { crew, run, ownerCtx } = await seedCrew([{ name: 'table_query', mode: 'read' }]);
    const result = await runEval(env as never, {
      crew,
      run,
      ownerCtx,
      input: 'Go.',
      provider: mockProvider([{ text: 'Here is my answer.', toolCalls: [] }]),
    });
    expect(result.terminationReason).toBe('goal_met');
  });
});

describe('awaiting_approval termination (#3a)', () => {
  it('reports awaiting_approval (not goal_met) when a write is queued for approval', async () => {
    const { crew, run, ownerCtx } = await seedCrew([{ name: 'email_send', mode: 'write', approval: 'always' }]);

    const result = await runEval(env as never, {
      crew,
      run,
      ownerCtx,
      input: 'Email the owner.',
      provider: mockProvider([
        { toolCalls: [{ name: 'email_send', input: { subject: 'x', text: 'y', to: ['a@b.com'] } }] },
        { toolCalls: [{ name: 'finish', input: { summary: 'done' } }] },
      ]),
    });

    expect(result.terminationReason).toBe('awaiting_approval');
    // The write was captured for approval, not executed.
    const appr = await env.DB.prepare(
      `SELECT status FROM crew_action_approvals WHERE crew_id = ? AND tool_name = 'email_send'`
    ).bind(crew.id).first<{ status: string }>();
    expect(appr?.status).toBe('pending');
  });
});
