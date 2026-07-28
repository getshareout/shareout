// Run Inspector serializer: normalize crew / job / alert runs into one shape and
// list them across surfaces. Uses real env.DB (the workers pool doesn't apply
// migrations, so the tables the serializer reads are created here).
import { env } from 'cloudflare:test';
import { beforeAll, describe, it, expect } from 'vitest';
import { getRunDetail, listWorkspaceRuns } from '../../../src/runs/inspector';

const WS = 'wsp_runs';
const ART = 'art_runs';

beforeAll(async () => {
  const ddl = [
    `CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, workspace_id TEXT, owner_id TEXT, name TEXT, slug TEXT)`,
    `CREATE TABLE IF NOT EXISTS crews (id TEXT PRIMARY KEY, artifact_id TEXT, crew_id TEXT, name TEXT, model TEXT)`,
    `CREATE TABLE IF NOT EXISTS crew_runs (id TEXT PRIMARY KEY, crew_id TEXT, artifact_id TEXT, trigger_kind TEXT, status TEXT,
       termination_reason TEXT, result_text TEXT, token_input INTEGER, token_output INTEGER, cost_micro_usd INTEGER,
       started_at TEXT, ended_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS crew_run_events (id TEXT PRIMARY KEY, run_id TEXT, crew_id TEXT, seq INTEGER, event_type TEXT,
       tool_name TEXT, input_json TEXT, output_json TEXT, token_input INTEGER, token_output INTEGER, latency_ms INTEGER, created_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS scheduled_jobs (id TEXT PRIMARY KEY, artifact_id TEXT, action TEXT, schedule TEXT,
       trigger_type TEXT, event_type TEXT, title TEXT)`,
    `CREATE TABLE IF NOT EXISTS job_runs (id TEXT PRIMARY KEY, job_id TEXT, created_at TEXT, status TEXT, duration_ms INTEGER, error TEXT)`,
    `CREATE TABLE IF NOT EXISTS job_run_steps (id TEXT PRIMARY KEY, run_id TEXT, job_id TEXT, seq INTEGER, step TEXT, status TEXT,
       duration_ms INTEGER, detail_json TEXT, created_at INTEGER)`,
    `CREATE TABLE IF NOT EXISTS metric_alert_rules (id TEXT PRIMARY KEY, workspace_id TEXT, name TEXT, schedule TEXT, condition_json TEXT)`,
    `CREATE TABLE IF NOT EXISTS metric_alert_runs (id TEXT PRIMARY KEY, rule_id TEXT, artifact_id TEXT, metric_id TEXT,
       evaluated_at INTEGER, value REAL, matched INTEGER, delivered INTEGER, destination_kind TEXT, error TEXT, message TEXT,
       threshold REAL, delivery_detail TEXT)`,
  ];
  for (const s of ddl) await env.DB.prepare(s).run();

  await env.DB.prepare(`INSERT INTO artifacts (id, workspace_id, owner_id, name, slug) VALUES (?, ?, 'u1', 'Report', 'report')`)
    .bind(ART, WS).run();

  // Crew run with a two-event ledger.
  await env.DB.prepare(`INSERT INTO crews (id, artifact_id, name, model) VALUES ('crew1', ?, 'Northwind', 'claude-sonnet-4-20250514')`).bind(ART).run();
  await env.DB.prepare(`INSERT INTO crew_runs (id, crew_id, artifact_id, trigger_kind, status, result_text, token_input, token_output, cost_micro_usd, started_at, ended_at)
     VALUES ('crun1', 'crew1', ?, 'cron', 'done', 'Posted summary', 1200, 380, 3000, '2026-06-26T13:00:00Z', '2026-06-26T13:00:04Z')`).bind(ART).run();
  await env.DB.prepare(`INSERT INTO crew_run_events (id, run_id, crew_id, seq, event_type, tool_name, output_json, latency_ms, created_at)
     VALUES ('e1', 'crun1', 'crew1', 0, 'tool_call', 'query_snapshot', '{"rows":142}', 1800, '2026-06-26T13:00:01Z')`).run();
  await env.DB.prepare(`INSERT INTO crew_run_events (id, run_id, crew_id, seq, event_type, tool_name, latency_ms, created_at)
     VALUES ('e2', 'crun1', 'crew1', 1, 'finish', NULL, 0, '2026-06-26T13:00:04Z')`).run();

  // Job run with a fetch step.
  await env.DB.prepare(`INSERT INTO scheduled_jobs (id, artifact_id, action, schedule, trigger_type, title) VALUES ('job1', ?, 'query_snapshot', '0 13 * * *', 'cron', 'Daily refresh')`).bind(ART).run();
  await env.DB.prepare(`INSERT INTO job_runs (id, job_id, created_at, status, duration_ms, error) VALUES ('log1', 'job1', '2026-07-01T15:00:00.000Z', 'success', 1850, NULL)`).run();
  await env.DB.prepare(`INSERT INTO job_run_steps (id, run_id, job_id, seq, step, status, duration_ms, detail_json)
     VALUES ('s1', 'log1', 'job1', 0, 'fetch', 'success', 1800, '{"target":"table:sales","rowCount":142}')`).run();

  // Alert event that matched and delivered.
  await env.DB.prepare(`INSERT INTO metric_alert_rules (id, workspace_id, name, schedule, condition_json) VALUES ('rule1', ?, 'Revenue drop', '0 * * * *', '{"op":"lt","value":1000}')`).bind(WS).run();
  await env.DB.prepare(`INSERT INTO metric_alert_runs (id, rule_id, artifact_id, metric_id, evaluated_at, value, matched, delivered, destination_kind, message, threshold, delivery_detail)
     VALUES ('mev1', 'rule1', ?, 'revenue', 1782999600, 800, 1, 1, 'slack', 'Revenue is now 800', 1000, '{"destination":"slack","ok":true}')`).bind(ART).run();
});

describe('getRunDetail', () => {
  it('normalizes a crew run with its event ledger', async () => {
    const run = await getRunDetail(env as any, WS, 'crew', 'crun1');
    expect(run).toBeTruthy();
    expect(run!.surface).toBe('crew');
    expect(run!.status).toBe('done');
    expect(run!.trigger).toBe('cron');
    expect(run!.costMicroUsd).toBe(3000);
    expect(run!.steps).toHaveLength(2);
    expect(run!.steps[0].label).toBe('query_snapshot');
    expect(run!.steps[0].output).toEqual({ rows: 142 });
    expect(run!.result).toBe('Posted summary');
  });

  it('normalizes a job run with its step ledger', async () => {
    const run = await getRunDetail(env as any, WS, 'job', 'log1');
    expect(run!.surface).toBe('job');
    expect(run!.status).toBe('success');
    expect(run!.trigger).toBe('cron: 0 13 * * *');
    expect(run!.steps).toHaveLength(1);
    expect(run!.steps[0].type).toBe('fetch');
    expect(run!.steps[0].output).toEqual({ target: 'table:sales', rowCount: 142 });
    expect(run!.delivery?.kind).toBe('query_snapshot');
  });

  it('normalizes an alert event into evaluate + deliver steps', async () => {
    const run = await getRunDetail(env as any, WS, 'alert', 'mev1');
    expect(run!.surface).toBe('alert');
    expect(run!.status).toBe('delivered');
    expect(run!.steps).toHaveLength(2);
    expect(run!.steps[0].type).toBe('evaluate');
    expect((run!.steps[0].output as any).threshold).toBe(1000);
    expect(run!.steps[1].type).toBe('deliver');
    expect(run!.steps[1].label).toBe('slack');
  });

  it('scopes to the workspace (wrong workspace → null)', async () => {
    expect(await getRunDetail(env as any, 'wsp_other', 'crew', 'crun1')).toBeNull();
    expect(await getRunDetail(env as any, WS, 'job', 'nope')).toBeNull();
  });
});

describe('listWorkspaceRuns', () => {
  it('lists runs across all three surfaces, newest first', async () => {
    const runs = await listWorkspaceRuns(env as any, WS);
    const surfaces = runs.map((r) => r.surface).sort();
    expect(surfaces).toEqual(['alert', 'crew', 'job']);
  });

  it('filters by surface', async () => {
    const runs = await listWorkspaceRuns(env as any, WS, { surface: 'crew' });
    expect(runs).toHaveLength(1);
    expect(runs[0].surface).toBe('crew');
    expect(runs[0].source).toBe('Northwind');
  });

  it('filters by status', async () => {
    const ok = await listWorkspaceRuns(env as any, WS, { status: 'success' });
    expect(ok.every((r) => ['done', 'success', 'delivered'].includes(r.status))).toBe(true);
    expect(ok).toHaveLength(3);
  });
});
