// Real D1: next_run_at is ISO text, so the due check must compare ISO to ISO.
import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/scheduling/jobs/runner', () => ({
  executeJobAction: vi.fn(async () => ({ success: true })),
  recordJobSteps: vi.fn(async () => {}),
}));

import { runScheduledJobs } from '../../../src/scheduling/jobs/execute';
import { executeJobAction } from '../../../src/scheduling/jobs/runner';

beforeAll(async () => {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS scheduled_jobs (id TEXT PRIMARY KEY, artifact_id TEXT, owner_id TEXT, action TEXT, schedule TEXT,
    config TEXT, next_run_at TEXT NOT NULL, last_run_at TEXT, last_status TEXT, last_error TEXT, retry_count INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1, max_attempts INTEGER NOT NULL DEFAULT 1, backoff_type TEXT NOT NULL DEFAULT 'fixed',
    initial_delay INTEGER NOT NULL DEFAULT 300, trigger_type TEXT NOT NULL DEFAULT 'cron', event_type TEXT)`).run();
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS job_runs (id TEXT PRIMARY KEY, job_id TEXT, created_at TEXT, status TEXT, duration_ms INTEGER, error TEXT)`).run();
});

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM scheduled_jobs').run();
  await env.DB.prepare('DELETE FROM job_runs').run();
  vi.mocked(executeJobAction).mockClear();
});

const seed = (id: string, nextRunAt: string) =>
  env.DB.prepare(`INSERT INTO scheduled_jobs (id, artifact_id, owner_id, action, schedule, config, next_run_at) VALUES (?, 'art_1', 'usr_1', 'email', '0 13 * * 1', '{}', ?)`)
    .bind(id, nextRunAt).run();

describe('runScheduledJobs due check', () => {
  it('runs a job whose ISO next_run_at has passed and advances it to the next ISO slot', async () => {
    await seed('job_due', new Date(Date.now() - 60_000).toISOString());
    expect(await runScheduledJobs(env as never)).toEqual({ executed: 1, failed: 0 });
    expect(executeJobAction).toHaveBeenCalledTimes(1);
    const row = await env.DB.prepare(`SELECT next_run_at FROM scheduled_jobs WHERE id='job_due'`).first<{ next_run_at: string }>();
    expect(row!.next_run_at).toMatch(/^\d{4}-\d{2}-\d{2}T13:00:00\.000Z$/);
    expect(row!.next_run_at > new Date().toISOString()).toBe(true);
  });

  it('leaves a job whose next_run_at is in the future alone', async () => {
    await seed('job_later', new Date(Date.now() + 3600_000).toISOString());
    expect(await runScheduledJobs(env as never)).toEqual({ executed: 0, failed: 0 });
    expect(executeJobAction).not.toHaveBeenCalled();
  });
});
