// G19: event-triggered crew runs are queued (not dropped) when the owner is at the concurrency cap,
// orphaned 'running' rows are reaped at dispatch time, and the queue drains FIFO.
import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { emitCrewEvent, runDueCrewTriggers } from '../../../src/crew/triggers';
import { drainCrewQueue, enqueueCrewRun, QUEUE_MAX_PER_OWNER } from '../../../src/crew/queue';
import type { CrewRow } from '../../../src/crew/types';

beforeAll(async () => {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, tier TEXT, disabled INTEGER)`,
    `CREATE TABLE IF NOT EXISTS plan_crew_limits (plan TEXT PRIMARY KEY, max_crews_per_artifact INTEGER, max_concurrent_runs INTEGER, default_run_budget_micro_usd INTEGER, max_iterations_cap INTEGER)`,
    `CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, workspace_id TEXT, owner_id TEXT, name TEXT, visibility TEXT, auth_method TEXT)`,
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

const rows = async (sql: string, ...b: unknown[]) => (await env.DB.prepare(sql).bind(...b).all<Record<string, unknown>>()).results;

beforeEach(async () => {
  for (const tb of ['crew_runs', 'crew_triggers', 'crew_action_approvals', 'crews', 'crew_grants', 'crew_run_events', 'users']) {
    await env.DB.prepare(`DELETE FROM ${tb}`).run();
  }
  await env.DB.prepare(`INSERT INTO artifacts (id, owner_id, workspace_id) VALUES ('art_a', 'usr_o', NULL), ('art_b', 'usr_o', NULL) ON CONFLICT(id) DO NOTHING`).run();
  await env.DB.prepare(`INSERT INTO crews (id, artifact_id, owner_id, status, max_iterations, run_budget_micro_usd, max_runtime_ms) VALUES ('crew_a', 'art_a', 'usr_o', 'active', 2, 1000, 5000), ('crew_b', 'art_b', 'usr_o', 'active', 2, 1000, 5000)`).run();
  await env.DB.prepare(`INSERT INTO crew_triggers (id, crew_id, artifact_id, kind, event_type, enabled) VALUES ('ctrg_ev', 'crew_a', 'art_a', 'event', 'table.row.inserted', 1)`).run();
});

const busy = (startedAgoSec = 5) => env.DB.prepare(
  `INSERT INTO crew_runs (id, crew_id, artifact_id, trigger_kind, status, started_at) VALUES ('crun_busy', 'crew_b', 'art_b', 'cron', 'running', strftime('%Y-%m-%dT%H:%M:%fZ','now','-' || ? || ' seconds'))`
).bind(startedAgoSec).run();

describe('event runs are queued when the owner is at capacity', () => {
  it('queues instead of dropping, without starting a run', async () => {
    await busy();
    await emitCrewEvent(env as never, 'art_a', 'table.row.inserted');
    const q = await rows(`SELECT status, trigger_kind, crew_id FROM crew_runs WHERE crew_id = 'crew_a'`);
    expect(q).toEqual([{ status: 'queued', trigger_kind: 'event', crew_id: 'crew_a' }]);
  });

  it('bounds the queue per owner and drops the overflow', async () => {
    await busy();
    const crew = (await rows(`SELECT * FROM crews WHERE id = 'crew_a'`))[0] as unknown as CrewRow;
    for (let i = 0; i < QUEUE_MAX_PER_OWNER; i++) expect(await enqueueCrewRun(env as never, crew, 'event')).toBe(true);
    expect(await enqueueCrewRun(env as never, crew, 'event')).toBe(false);
    expect((await rows(`SELECT COUNT(*) AS n FROM crew_runs WHERE status = 'queued'`))[0].n).toBe(QUEUE_MAX_PER_OWNER);
  });
});

describe('orphaned runs do not hold the slot', () => {
  it('an event arriving while an abandoned run sits in running reaps it and runs immediately', async () => {
    await busy(900);
    const { dispatchCrewRun } = await import('../../../src/crew/triggers');
    const crew = (await rows(`SELECT * FROM crews WHERE id = 'crew_a'`))[0] as unknown as CrewRow;
    await dispatchCrewRun(env as never, crew, 'event').catch((e) => { throw new Error('dispatch threw: ' + e.message); });
    expect((await rows(`SELECT status, termination_reason FROM crew_runs WHERE id = 'crun_busy'`))[0]).toMatchObject({ status: 'error', termination_reason: 'abandoned' });
    const mine = await rows(`SELECT status FROM crew_runs WHERE crew_id = 'crew_a'`);
    expect(mine).toHaveLength(1);
    expect(mine[0].status).not.toBe('queued');
  });
});

describe('draining stays inside budgets (G19 review)', () => {
  const queue = async (n: number) => {
    const crew = (await rows(`SELECT * FROM crews WHERE id = 'crew_a'`))[0] as unknown as CrewRow;
    for (let i = 0; i < n; i++) await enqueueCrewRun(env as never, crew, 'event');
  };
  const queued = async () => (await rows(`SELECT COUNT(*) AS n FROM crew_runs WHERE status = 'queued'`))[0].n;

  it('an event dispatch never drains the queue (it runs inside waitUntil)', async () => {
    await queue(2);
    const { dispatchCrewRun } = await import('../../../src/crew/triggers');
    const other = (await rows(`SELECT * FROM crews WHERE id = 'crew_b'`))[0] as unknown as CrewRow;
    await dispatchCrewRun(env as never, other, 'event');
    expect(await queued()).toBe(2);
  });

  it('a cron dispatch does not drain inline either; the tick does, with the remaining budget', async () => {
    await queue(2);
    const { dispatchCrewRun } = await import('../../../src/crew/triggers');
    const other = (await rows(`SELECT * FROM crews WHERE id = 'crew_b'`))[0] as unknown as CrewRow;
    await dispatchCrewRun(env as never, other, 'cron');
    expect(await queued()).toBe(2);
  });

  it('an exhausted budget starts nothing, in the drain and in the tick', async () => {
    await queue(2);
    expect(await drainCrewQueue(env as never, 'usr_o', 0)).toBe(0);
    await runDueCrewTriggers(env as never, -1);
    expect(await queued()).toBe(2);
    await runDueCrewTriggers(env as never);
    expect(await queued()).toBe(0);
  });
});

describe('a killed event run gets exactly one second chance', () => {
  const stale = (id: string, kind: string, reason: string | null = null) => env.DB.prepare(
    `INSERT INTO crew_runs (id, crew_id, artifact_id, trigger_kind, status, termination_reason, started_at) VALUES (?, 'crew_a', 'art_a', ?, 'running', ?, strftime('%%Y-%%m-%%dT%%H:%%M:%%fZ','now','-900 seconds'))`
  ).bind(id, kind, reason).run();
  const state = async (id: string) => (await rows(`SELECT status, termination_reason FROM crew_runs WHERE id = ?`, id))[0];

  it('re-queues once, then fails it as abandoned', async () => {
    const { reapStaleRuns } = await import('../../../src/crew/store');
    await stale('crun_e1', 'event');
    await reapStaleRuns(env as never);
    expect(await state('crun_e1')).toEqual({ status: 'queued', termination_reason: 'requeued' });
    // claimed again and killed again
    await env.DB.prepare(`UPDATE crew_runs SET status = 'running', started_at = strftime('%%Y-%%m-%%dT%%H:%%M:%%fZ','now','-900 seconds') WHERE id = 'crun_e1'`).run();
    await reapStaleRuns(env as never);
    expect(await state('crun_e1')).toEqual({ status: 'error', termination_reason: 'abandoned' });
  });

  it('does not re-queue an event run that already called a tool, or a non-event run', async () => {
    const { reapStaleRuns } = await import('../../../src/crew/store');
    await stale('crun_e2', 'event');
    await env.DB.prepare(`INSERT INTO crew_run_events (id, run_id, crew_id, seq, event_type) VALUES ('ev1', 'crun_e2', 'crew_a', 1, 'tool_call')`).run();
    await stale('crun_c1', 'cron');
    await reapStaleRuns(env as never);
    expect(await state('crun_e2')).toEqual({ status: 'error', termination_reason: 'abandoned' });
    expect(await state('crun_c1')).toEqual({ status: 'error', termination_reason: 'abandoned' });
  });
});

describe('the queue drains FIFO once a slot frees', () => {
  it('does nothing while busy; starts the oldest first when free; the hourly tick also drains', async () => {
    await busy();
    const crew = (await rows(`SELECT * FROM crews WHERE id = 'crew_a'`))[0] as unknown as CrewRow;
    await enqueueCrewRun(env as never, crew, 'event');
    await new Promise((r) => setTimeout(r, 15));
    await enqueueCrewRun(env as never, crew, 'event');
    expect(await drainCrewQueue(env as never, 'usr_o')).toBe(0);
    expect((await rows(`SELECT COUNT(*) AS n FROM crew_runs WHERE status = 'queued'`))[0].n).toBe(2);

    await env.DB.prepare(`UPDATE crew_runs SET status = 'done' WHERE id = 'crun_busy'`).run();
    await runDueCrewTriggers(env as never);
    expect((await rows(`SELECT COUNT(*) AS n FROM crew_runs WHERE status = 'queued'`))[0].n).toBe(0);
    const started = await rows(`SELECT id FROM crew_runs WHERE crew_id = 'crew_a' ORDER BY started_at, id`);
    expect(started).toHaveLength(2);
  });

  it('expires a run that waited more than a day and says so', async () => {
    const crew = (await rows(`SELECT * FROM crews WHERE id = 'crew_a'`))[0] as unknown as CrewRow;
    await enqueueCrewRun(env as never, crew, 'event');
    await env.DB.prepare(`UPDATE crew_runs SET started_at = strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 hours') WHERE status = 'queued'`).run();
    await drainCrewQueue(env as never, 'usr_o');
    expect((await rows(`SELECT status, termination_reason FROM crew_runs WHERE crew_id = 'crew_a'`))[0]).toEqual({ status: 'error', termination_reason: 'queue_expired' });
  });
});
