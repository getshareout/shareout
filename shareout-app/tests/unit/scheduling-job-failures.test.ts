// A failing job must never be silent: manual runs persist their outcome on the job,
// and the owner gets one actionable email when a job starts failing.
import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../src/types';

const dispatchLifecycleEmail = vi.hoisted(() => vi.fn());
vi.mock('../../src/email/gateway', () => ({ dispatchLifecycleEmail }));

const executeJobAction = vi.hoisted(() => vi.fn());
vi.mock('../../src/scheduling/jobs/runner', async (orig) => ({
  ...(await orig<typeof import('../../src/scheduling/jobs/runner')>()),
  executeJobAction,
}));

import { notifyJobFailed } from '../../src/scheduling/jobs/notify';
import { executeJobNow } from '../../src/scheduling/jobs/execute';
import { EMAILS } from '../../src/email/catalog';
import type { ScheduledJob } from '../../src/scheduling/jobs/types';

const e = env as unknown as Env;
const job = {
  id: 'job_f1', artifact_id: 'art_f1', owner_id: 'usr_f1', title: 'Morning KPIs', action: 'query_snapshot',
  schedule: '0 9 * * *', config: '{}', next_run_at: 1, retry_count: 0,
} as unknown as ScheduledJob;

beforeAll(async () => {
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS scheduled_jobs (id TEXT PRIMARY KEY, artifact_id TEXT, owner_id TEXT, action TEXT, schedule TEXT, config TEXT,
       next_run_at INTEGER, last_run_at INTEGER, last_status TEXT, last_error TEXT, retry_count INTEGER DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS job_runs (id TEXT PRIMARY KEY, job_id TEXT, created_at INTEGER, status TEXT, duration_ms INTEGER, error TEXT)`,
    `CREATE TABLE IF NOT EXISTS job_run_steps (id TEXT PRIMARY KEY, run_id TEXT, job_id TEXT, seq INTEGER, step TEXT, status TEXT, duration_ms INTEGER, detail_json TEXT)`,
  ]) await e.DB.prepare(sql).run();
});

beforeEach(async () => {
  for (const t of ['scheduled_jobs', 'job_runs', 'job_run_steps']) await e.DB.exec(`DELETE FROM ${t}`);
  await e.DB.prepare(`INSERT INTO scheduled_jobs (id, artifact_id, owner_id, action, schedule, config, next_run_at, last_status)
    VALUES ('job_f1', 'art_f1', 'usr_f1', 'query_snapshot', '0 9 * * *', '{}', 1, 'success')`).run();
  dispatchLifecycleEmail.mockReset();
  executeJobAction.mockReset();
});

describe('executeJobNow', () => {
  it('records the run and the failure reason on the job, leaving the schedule alone', async () => {
    executeJobAction.mockResolvedValueOnce({ success: false, error: 'Connection "warehouse" not found' });
    const res = await executeJobNow(e, job);
    expect(res).toMatchObject({ success: false, status: 'failed', error: 'Connection "warehouse" not found' });

    const row = await e.DB.prepare('SELECT last_status, last_error, last_run_at, next_run_at FROM scheduled_jobs WHERE id = ?')
      .bind('job_f1').first<Record<string, unknown>>();
    expect(row).toMatchObject({ last_status: 'failed', last_error: 'Connection "warehouse" not found', next_run_at: 1 });
    expect(row?.last_run_at).toBeTypeOf('number');

    const run = await e.DB.prepare('SELECT status, error FROM job_runs WHERE job_id = ?').bind('job_f1').first();
    expect(run).toEqual({ status: 'failed', error: 'Connection "warehouse" not found' });
  });

  it('clears the old error on success', async () => {
    await e.DB.exec(`UPDATE scheduled_jobs SET last_status = 'failed', last_error = 'boom'`);
    executeJobAction.mockResolvedValueOnce({ success: true });
    await executeJobNow(e, job);
    const row = await e.DB.prepare('SELECT last_status, last_error FROM scheduled_jobs').first();
    expect(row).toEqual({ last_status: 'success', last_error: null });
  });
});

describe('notifyJobFailed', () => {
  it('emails the owner with the job name and the reason', async () => {
    await notifyJobFailed(e, job, 'Connection "warehouse" not found');
    expect(dispatchLifecycleEmail).toHaveBeenCalledWith(e, {
      type: 'job_failed',
      toUserId: 'usr_f1',
      data: { jobName: 'Morning KPIs', error: 'Connection "warehouse" not found' },
    });
  });

  it('never throws into the cron batch', async () => {
    dispatchLifecycleEmail.mockRejectedValueOnce(new Error('mail down'));
    await expect(notifyJobFailed(e, { ...job, title: null }, 'x')).resolves.toBeUndefined();
  });

  it('builds copy that names the job, quotes the error and links to Schedules', () => {
    const built = EMAILS.job_failed.build({ jobName: 'Morning KPIs', error: '<b>401</b> from warehouse' }, { env: e, baseUrl: 'https://so.example' });
    expect(built.subject).toBe('Your schedule "Morning KPIs" failed');
    expect(built.bodyHtml).toContain('&lt;b&gt;401&lt;/b&gt; from warehouse');
    expect(built.cta).toEqual({ label: 'Open Schedules', href: 'https://so.example/home#l/schedules' });
  });
});
