import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../src/types';

const jobs = vi.hoisted(() => ({
  createJob: vi.fn(),
  listJobs: vi.fn(),
  listJobsForArtifact: vi.fn(),
  deleteJob: vi.fn(),
  updateJob: vi.fn(),
  getJobLogs: vi.fn(),
  createArtifactEmail: vi.fn(),
  getArtifactEmail: vi.fn(),
  runScheduledJobs: vi.fn(),
  runJobManually: vi.fn(),
}));

const getUserRole = vi.hoisted(() => vi.fn());
const purgeSoftDeleted = vi.hoisted(() => vi.fn(async () => 0));

const analytics = vi.hoisted(() => ({
  aggregateDailyStats: vi.fn(),
  cleanupOldEvents: vi.fn(),
}));

const apiAuth = vi.hoisted(() => ({
  cleanupExpiredAdminSessions: vi.fn(),
  cleanupOldRateLimits: vi.fn(async () => 0),
}));

const crewTriggers = vi.hoisted(() => ({
  runDueCrewTriggers: vi.fn(),
}));

const metricAlerts = vi.hoisted(() => ({
  runDueMetricAlerts: vi.fn(),
}));

const teamMetrics = vi.hoisted(() => ({
  writeTeamDashboardSnapshots: vi.fn(async () => []),
}));

vi.mock('../../src/scheduling/jobs', () => jobs);
vi.mock('../../src/artifacts', () => ({ getUserRole, purgeSoftDeleted }));
vi.mock('../../src/analytics', () => analytics);
vi.mock('../../src/api-auth', () => apiAuth);
vi.mock('../../src/crew/triggers', () => crewTriggers);
vi.mock('../../src/metric-alerts/rules', () => metricAlerts);
vi.mock('../../src/team-metrics/snapshot-writer', () => teamMetrics);

import {
  handleCreateArtifactEmail,
  handleCreateJob,
  handleDeleteJob,
  handleGetArtifactEmail,
  handleGetJob,
  handleListJobs,
  handleScheduledEvent,
  handleUpdateJob,
} from '../../src/scheduling/handler';

const user = { id: 'user_1', email: 'owner@example.com' };
const env = {} as Env;

async function jsonBody(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('handleCreateJob', () => {
  it('rejects invalid JSON and missing required fields', async () => {
    const badJson = await handleCreateJob(new Request('https://x', { method: 'POST', body: '{' }), env, user);
    expect(badJson.status).toBe(400);
    expect(await jsonBody(badJson)).toMatchObject({ code: 'INVALID_JSON' });

    const missingArtifact = await handleCreateJob(
      new Request('https://x', { method: 'POST', body: JSON.stringify({ action: 'email' }) }),
      env,
      user
    );
    expect(missingArtifact.status).toBe(400);
    expect(await jsonBody(missingArtifact)).toMatchObject({ error: 'artifact_id required' });

    const badAction = await handleCreateJob(
      new Request('https://x', {
        method: 'POST',
        body: JSON.stringify({ artifact_id: 'art_1', action: 'sms', schedule: '* * * * *', config: {} }),
      }),
      env,
      user
    );
    expect(await jsonBody(badAction)).toMatchObject({ error: 'action must be one of: email, webhook, slack, discord, http_get, materialize, query_snapshot, sheets_append, artifact_test' });

    const missingSchedule = await handleCreateJob(
      new Request('https://x', {
        method: 'POST',
        body: JSON.stringify({ artifact_id: 'art_1', action: 'email', config: {} }),
      }),
      env,
      user
    );
    expect(await jsonBody(missingSchedule)).toMatchObject({ error: 'schedule required for cron jobs' });

    const missingConfig = await handleCreateJob(
      new Request('https://x', {
        method: 'POST',
        body: JSON.stringify({ artifact_id: 'art_1', action: 'email', schedule: '0 9 * * *' }),
      }),
      env,
      user
    );
    expect(await jsonBody(missingConfig)).toMatchObject({ error: 'config required' });
  });

  it('returns createJob errors and success payloads', async () => {
    jobs.createJob.mockResolvedValueOnce({ error: 'Invalid cron' });
    const failed = await handleCreateJob(
      new Request('https://x', {
        method: 'POST',
        body: JSON.stringify({
          artifact_id: 'art_1',
          action: 'email',
          schedule: 'bad',
          config: { recipients: ['a@example.com'], subject: 'Hi' },
        }),
      }),
      env,
      user
    );
    expect(failed.status).toBe(400);
    expect(await jsonBody(failed)).toMatchObject({ error: 'Invalid cron' });

    // A DB constraint guard can reject input the handler does not pre-validate
    // (e.g. backoff_type, which createJob passes straight through). Such a
    // SQLITE_CONSTRAINT failure must surface as a 400, not bubble up as a 500.
    jobs.createJob.mockRejectedValueOnce(
      new Error(
        "D1_ERROR: backoff_type must be fixed, linear, or exponential: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_TRIGGER)"
      )
    );
    const constrained = await handleCreateJob(
      new Request('https://x', {
        method: 'POST',
        body: JSON.stringify({
          artifact_id: 'art_1',
          action: 'webhook',
          schedule: '0 9 * * *',
          retry_config: { backoffType: 'quadratic' },
          config: { url: 'https://hook.example.com' },
        }),
      }),
      env,
      user
    );
    expect(constrained.status).toBe(400);
    expect(await jsonBody(constrained)).toMatchObject({
      code: 'INVALID_REQUEST',
      error: 'backoff_type must be fixed, linear, or exponential',
    });

    const job = { id: 'job_1', artifact_id: 'art_1' };
    jobs.createJob.mockResolvedValueOnce({ job });
    const ok = await handleCreateJob(
      new Request('https://x', {
        method: 'POST',
        body: JSON.stringify({
          artifact_id: 'art_1',
          action: 'webhook',
          schedule: '0 9 * * *',
          config: { url: 'https://hook.example.com' },
        }),
      }),
      env,
      user
    );
    expect(ok.status).toBe(201);
    expect(await jsonBody(ok)).toEqual({ job });
  });
});

describe('handleListJobs and handleGetJob', () => {
  it('lists artifact-scoped jobs via listJobsForArtifact, unscoped via listJobs', async () => {
    jobs.listJobsForArtifact.mockResolvedValueOnce([{ id: 'job_1' }]);
    const filtered = await handleListJobs(new Request('https://x?artifact_id=art_1'), env, user);
    expect(jobs.listJobsForArtifact).toHaveBeenCalledWith(env, 'art_1', 'user_1');
    expect(await jsonBody(filtered)).toEqual({ jobs: [{ id: 'job_1' }] });

    jobs.listJobs.mockResolvedValueOnce([]);
    await handleListJobs(new Request('https://x'), env, user);
    expect(jobs.listJobs).toHaveBeenLastCalledWith(env, 'user_1');
  });

  it('returns 404 when job is missing', async () => {
    jobs.listJobs.mockResolvedValueOnce([]);
    const response = await handleGetJob(env, user, 'job_missing');
    expect(response.status).toBe(404);
    expect(await jsonBody(response)).toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns a job when found', async () => {
    jobs.listJobs.mockResolvedValueOnce([{ id: 'job_1' }, { id: 'job_2' }]);
    const response = await handleGetJob(env, user, 'job_2');
    expect(await jsonBody(response)).toEqual({ job: { id: 'job_2' } });
  });
});

describe('handleUpdateJob', () => {
  it('rejects invalid JSON', async () => {
    const response = await handleUpdateJob(new Request('https://x', { method: 'PATCH', body: '{' }), env, user, 'job_1');
    expect(response.status).toBe(400);
    expect(await jsonBody(response)).toMatchObject({ code: 'INVALID_JSON' });
  });

  it('maps updateJob errors to status codes', async () => {
    jobs.updateJob.mockResolvedValueOnce({ error: 'Job not found' });
    expect((await handleUpdateJob(
      new Request('https://x', { method: 'PATCH', body: '{}' }),
      env,
      user,
      'job_1'
    )).status).toBe(404);

    jobs.updateJob.mockResolvedValueOnce({ error: 'Permission denied' });
    expect((await handleUpdateJob(
      new Request('https://x', { method: 'PATCH', body: '{}' }),
      env,
      user,
      'job_1'
    )).status).toBe(403);

    jobs.updateJob.mockResolvedValueOnce({ error: 'Invalid schedule' });
    expect((await handleUpdateJob(
      new Request('https://x', { method: 'PATCH', body: '{}' }),
      env,
      user,
      'job_1'
    )).status).toBe(400);

    jobs.updateJob.mockResolvedValueOnce({ job: { id: 'job_1', enabled: false } });
    const ok = await handleUpdateJob(
      new Request('https://x', { method: 'PATCH', body: JSON.stringify({ enabled: false }) }),
      env,
      user,
      'job_1'
    );
    expect(await jsonBody(ok)).toEqual({ job: { id: 'job_1', enabled: false } });
  });
});

describe('handleDeleteJob', () => {
  it('maps deleteJob errors and success', async () => {
    jobs.deleteJob.mockResolvedValueOnce({ error: 'Job not found' });
    expect((await handleDeleteJob(env, user, 'job_1')).status).toBe(404);

    jobs.deleteJob.mockResolvedValueOnce({ error: 'Permission denied' });
    expect((await handleDeleteJob(env, user, 'job_1')).status).toBe(403);

    jobs.deleteJob.mockResolvedValueOnce({});
    expect(await jsonBody(await handleDeleteJob(env, user, 'job_1'))).toEqual({ success: true });
  });
});

describe('handleCreateArtifactEmail', () => {
  it('accepts empty body and maps service errors', async () => {
    jobs.createArtifactEmail.mockResolvedValueOnce({ error: 'Artifact not found' });
    const notFound = await handleCreateArtifactEmail(
      new Request('https://x', { method: 'POST', body: 'not-json' }),
      env,
      user,
      'art_missing'
    );
    expect(notFound.status).toBe(404);

    jobs.createArtifactEmail.mockResolvedValueOnce({ error: 'Permission denied for artifact' });
    expect((await handleCreateArtifactEmail(new Request('https://x', { method: 'POST' }), env, user, 'art_1')).status)
      .toBe(403);

    jobs.createArtifactEmail.mockResolvedValueOnce({ error: 'Prefix taken' });
    expect((await handleCreateArtifactEmail(new Request('https://x', { method: 'POST' }), env, user, 'art_1')).status)
      .toBe(400);

    jobs.createArtifactEmail.mockResolvedValueOnce({ email: { prefix: 'report' } });
    const ok = await handleCreateArtifactEmail(
      new Request('https://x', { method: 'POST', body: JSON.stringify({ reply_to: 'owner@example.com' }) }),
      env,
      user,
      'art_1'
    );
    expect(ok.status).toBe(201);
    expect(jobs.createArtifactEmail).toHaveBeenCalledWith(env, 'user_1', 'art_1', 'owner@example.com');
  });
});

describe('handleGetArtifactEmail', () => {
  it('requires artifact access', async () => {
    getUserRole.mockResolvedValueOnce(null);
    const denied = await handleGetArtifactEmail(env, user, 'art_1');
    expect(denied.status).toBe(404);

    getUserRole.mockResolvedValueOnce('editor');
    jobs.getArtifactEmail.mockResolvedValueOnce({ prefix: 'report' });
    expect(await jsonBody(await handleGetArtifactEmail(env, user, 'art_1'))).toEqual({
      email: { prefix: 'report' },
    });
  });
});

describe('handleScheduledEvent', () => {
  beforeEach(() => {
    jobs.runScheduledJobs.mockResolvedValue({ executed: 0, failed: 0 });
    crewTriggers.runDueCrewTriggers.mockResolvedValue({ executed: 0, failed: 0 });
    metricAlerts.runDueMetricAlerts.mockResolvedValue({ evaluated: 0, triggered: 0 });
    analytics.aggregateDailyStats.mockResolvedValue(1);
    analytics.cleanupOldEvents.mockResolvedValue(2);
    apiAuth.cleanupExpiredAdminSessions.mockResolvedValue(3);
  });

  it('advances the rollup every tick but runs daily cleanup only at 01:00 UTC', async () => {
    vi.useFakeTimers();
    const logSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    // Off-hour tick: the rollup cursor advances (opt-006), but daily cleanup does not.
    vi.setSystemTime(new Date('2026-05-30T12:00:00Z'));
    await handleScheduledEvent(env);
    expect(analytics.aggregateDailyStats).toHaveBeenCalledWith(env);
    expect(analytics.cleanupOldEvents).not.toHaveBeenCalled();
    expect(apiAuth.cleanupExpiredAdminSessions).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: 'daily cleanup completed' }),
    );

    // 01:00 tick: the rollup advances again AND daily cleanup runs.
    vi.setSystemTime(new Date('2026-05-30T01:00:00Z'));
    jobs.runScheduledJobs.mockResolvedValueOnce({ executed: 2, failed: 1 });
    await handleScheduledEvent(env);
    expect(analytics.aggregateDailyStats).toHaveBeenCalledTimes(2);
    expect(analytics.cleanupOldEvents).toHaveBeenCalledWith(env);
    expect(apiAuth.cleanupExpiredAdminSessions).toHaveBeenCalledWith(env);
    // Structured logging: payloads are objects with a `message` field.
    expect(logSpy).toHaveBeenCalledWith(expect.objectContaining({ message: 'daily cleanup completed' }));
    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'scheduled jobs batch finished', executed: 2, failed: 1 }),
    );
  });

  it('gates off scheduledTime, not drifted wall-clock', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'info').mockImplementation(() => {});

    // Wall clock drifted to 01:05 (past the minute===0 window), but the cron was
    // scheduled for exactly 01:00 — daily cleanup must still run.
    vi.setSystemTime(new Date('2026-05-30T01:05:00Z'));
    await handleScheduledEvent(env, Date.parse('2026-05-30T01:00:00Z'));

    expect(analytics.cleanupOldEvents).toHaveBeenCalledWith(env);
    expect(apiAuth.cleanupExpiredAdminSessions).toHaveBeenCalledWith(env);
  });
});
