// P1 robustness: workspace schedules/automations/runs — admin gate + not-found + validation.
import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';
import type { AuthUser } from '../../../src/api-auth';

vi.mock('../../../src/scheduling/jobs', async (orig) => {
  const actual = await orig<typeof import('../../../src/scheduling/jobs')>();
  return {
    ...actual,
    executeJobNow: vi.fn().mockResolvedValue({ success: true }),
  };
});

vi.mock('../../../src/crew/store', () => ({
  getCrewById: vi.fn().mockResolvedValue({ id: 'crew1', status: 'active' }),
  listRuns: vi.fn().mockResolvedValue([{ id: 'run1' }]),
}));

vi.mock('../../../src/crew/triggers', () => ({
  dispatchCrewRun: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../../src/runs/inspector', () => ({
  listWorkspaceRuns: vi.fn().mockResolvedValue([{ id: 'r1', surface: 'job' }]),
  getRunDetail: vi.fn().mockResolvedValue({ id: 'r1', surface: 'job' }),
}));

import {
  handleListWorkspaceSchedules,
  handleGetWorkspaceScheduleLogs,
  handleRunWorkspaceSchedule,
  handleToggleWorkspaceSchedule,
  handleDeleteWorkspaceSchedule,
  handleListWorkspaceAutomations,
  handleGetWorkspaceAutomationRuns,
  handleRunWorkspaceAutomation,
  handleToggleWorkspaceAutomation,
  handleDeleteWorkspaceAutomation,
  handleListWorkspaceRuns,
  handleGetWorkspaceRun,
} from '../../../src/router/api/workspace-jobs';
import { executeJobNow } from '../../../src/scheduling/jobs';
import { dispatchCrewRun } from '../../../src/crew/triggers';
import { listWorkspaceRuns, getRunDetail } from '../../../src/runs/inspector';

const e = env as unknown as Env;
const admin: AuthUser = { id: 'usr_admin', email: 'a@x.com', username: null };
const member: AuthUser = { id: 'usr_member', email: 'm@x.com', username: null };
const WS = 'wsp_jobs';

beforeAll(async () => {
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, name TEXT)`,
    `CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT, owner_id TEXT, slug TEXT)`,
    `CREATE TABLE IF NOT EXISTS workspace_members (id TEXT PRIMARY KEY, workspace_id TEXT, user_id TEXT, role TEXT, member_class TEXT NOT NULL DEFAULT 'internal')`,
    `CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, workspace_id TEXT, name TEXT, slug TEXT)`,
    `CREATE TABLE IF NOT EXISTS deployments (artifact_id TEXT, channel TEXT, slug TEXT)`,
    `CREATE TABLE IF NOT EXISTS scheduled_jobs (id TEXT PRIMARY KEY, artifact_id TEXT, owner_id TEXT, title TEXT, description TEXT, action TEXT, schedule TEXT, config TEXT, trigger_type TEXT, event_type TEXT, enabled INTEGER, next_run_at TEXT, last_run_at TEXT, last_status TEXT, last_error TEXT, created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
    `CREATE TABLE IF NOT EXISTS job_runs (id TEXT PRIMARY KEY, job_id TEXT, created_at TEXT, status TEXT, duration_ms INTEGER, error TEXT)`,
    `CREATE TABLE IF NOT EXISTS crews (id TEXT PRIMARY KEY, name TEXT, status TEXT, model TEXT, instructions TEXT, owner_id TEXT)`,
    `CREATE TABLE IF NOT EXISTS crew_triggers (id TEXT PRIMARY KEY, crew_id TEXT, artifact_id TEXT, kind TEXT, cron TEXT, event_type TEXT, enabled INTEGER, next_run_at TEXT, last_run_at TEXT, created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT)`,
  ]) await e.DB.exec(sql);
});

beforeEach(async () => {
  for (const t of [
    'job_runs', 'crew_triggers', 'crews', 'scheduled_jobs', 'deployments',
    'artifacts', 'workspace_members', 'workspaces', 'users',
  ]) await e.DB.exec(`DELETE FROM ${t}`);

  await e.DB.exec(`INSERT INTO users (id, email) VALUES ('usr_admin','a@x.com'),('usr_member','m@x.com')`);
  await e.DB.exec(`INSERT INTO workspaces (id, name, owner_id, slug) VALUES ('${WS}','W','usr_admin','w')`);
  await e.DB.exec(`INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('m1','${WS}','usr_admin','admin','internal'),('m2','${WS}','usr_member','member','internal')`);
  await e.DB.exec(`INSERT INTO artifacts (id, workspace_id, name, slug) VALUES ('art1','${WS}','A','a')`);
  await e.DB.exec(`INSERT INTO scheduled_jobs (id, artifact_id, owner_id, title, action, schedule, config, trigger_type, enabled) VALUES ('job1','art1','usr_admin','Daily','email','0 9 * * *','{}','cron',1)`);
  await e.DB.exec(`INSERT INTO crews (id, name, status, model, instructions, owner_id) VALUES ('crew1','C','active','m','do stuff','usr_admin')`);
  await e.DB.exec(`INSERT INTO crew_triggers (id, crew_id, artifact_id, kind, cron, enabled) VALUES ('trg1','crew1','art1','cron','0 * * * *',1)`);
});

function jsonReq(body: unknown) {
  return new Request('https://shareout.site/v1/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('workspace schedules', () => {
  it('403s members; lists and runs for admins', async () => {
    expect((await handleListWorkspaceSchedules(e, member, WS)).status).toBe(403);

    const list = await handleListWorkspaceSchedules(e, admin, WS);
    expect(list.status).toBe(200);
    const { schedules } = await list.json() as { schedules: { id: string }[] };
    expect(schedules.map(s => s.id)).toContain('job1');

    expect((await handleGetWorkspaceScheduleLogs(e, admin, WS, 'missing')).status).toBe(404);
    await e.DB.exec(`INSERT INTO job_runs (id, job_id, created_at, status) VALUES ('l1','job1','2020-01-01T00:00:00.000Z','ok')`);
    const logs = await handleGetWorkspaceScheduleLogs(e, admin, WS, 'job1');
    expect(logs.status).toBe(200);
    expect((await logs.json() as { logs: unknown[] }).logs).toHaveLength(1);

    const run = await handleRunWorkspaceSchedule(e, admin, WS, 'job1');
    expect(run.status).toBe(200);
    expect(executeJobNow).toHaveBeenCalled();
  });

  it('validates cron on toggle and deletes', async () => {
    const bad = await handleToggleWorkspaceSchedule(jsonReq({ schedule: 'not cron' }), e, admin, WS, 'job1');
    expect(bad.status).toBe(400);
    expect((await bad.json() as { code: string }).code).toBe('INVALID_CRON');

    const ok = await handleToggleWorkspaceSchedule(jsonReq({ enabled: false, title: 'N' }), e, admin, WS, 'job1');
    expect(ok.status).toBe(200);

    expect((await handleDeleteWorkspaceSchedule(e, admin, WS, 'missing')).status).toBe(404);
    expect((await handleDeleteWorkspaceSchedule(e, admin, WS, 'job1')).status).toBe(200);
    expect((await handleRunWorkspaceSchedule(e, admin, WS, 'job1')).status).toBe(404);
  });
});

describe('workspace automations + runs', () => {
  it('gates automations and dispatches runs', async () => {
    expect((await handleListWorkspaceAutomations(e, member, WS)).status).toBe(403);
    const list = await handleListWorkspaceAutomations(e, admin, WS);
    expect((await list.json() as { automations: { id: string }[] }).automations[0].id).toBe('trg1');

    expect((await handleGetWorkspaceAutomationRuns(e, admin, WS, 'nope')).status).toBe(404);
    expect((await handleGetWorkspaceAutomationRuns(e, admin, WS, 'trg1')).status).toBe(200);

    const run = await handleRunWorkspaceAutomation(e, admin, WS, 'trg1');
    expect(run.status).toBe(200);
    expect(dispatchCrewRun).toHaveBeenCalled();

    expect((await handleToggleWorkspaceAutomation(jsonReq({ enabled: false }), e, admin, WS, 'trg1')).status).toBe(200);
    expect((await handleDeleteWorkspaceAutomation(e, admin, WS, 'trg1')).status).toBe(200);
  });

  it('validates run inspector surface', async () => {
    const bad = await handleListWorkspaceRuns(e, admin, WS, new URLSearchParams('surface=nope'));
    expect(bad.status).toBe(400);
    expect((await bad.json() as { code: string }).code).toBe('INVALID_SURFACE');

    const ok = await handleListWorkspaceRuns(e, admin, WS, new URLSearchParams('surface=job'));
    expect(ok.status).toBe(200);
    expect(listWorkspaceRuns).toHaveBeenCalled();

    expect((await handleGetWorkspaceRun(e, admin, WS, 'nope', 'r1')).status).toBe(400);
    vi.mocked(getRunDetail).mockResolvedValueOnce(null as never);
    expect((await handleGetWorkspaceRun(e, admin, WS, 'job', 'missing')).status).toBe(404);
  });
});
