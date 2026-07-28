import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../src/types';

const getUserRole = vi.hoisted(() => vi.fn());
const checkEmailRateLimit = vi.hoisted(() => vi.fn());
const sendArtifactEmail = vi.hoisted(() => vi.fn());
const incrementEmailCount = vi.hoisted(() => vi.fn());

vi.mock('../../src/artifacts', () => ({ getUserRole }));

// Feature gates are off-topic here and would add DB reads to the strict-sequence
// mocks below; treat every feature as enabled.
vi.mock('../../src/features/flags', () => ({
  isFeatureEnabled: vi.fn().mockResolvedValue(true),
  isArtifactFeatureEnabled: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../src/crypto-utils', () => ({
  generateId: vi.fn((prefix: string) => `${prefix}_test1234567890ab`),
}));

vi.mock('../../src/scheduling/email', () => ({
  checkEmailRateLimit,
  sendArtifactEmail,
  incrementEmailCount,
  artifactEmailAddress: (prefix: string, env: Env) =>
    `${prefix}@${(env as Env).EMAIL_ARTIFACTS_DOMAIN || 'artifacts.shareout.site'}`,
  inboxAddress: (prefix: string, env: Env) =>
    `${prefix}@${(env as Env).EMAIL_INBOX_DOMAIN || 'inbox.shareout.site'}`,
  // Mirrors the real collision loop against env.DB; fallback suffix matches the
  // mocked generateId ('e_test1234567890ab'.slice(2,10) === 'test1234').
  generateEmailPrefix: async (env: Env, slug: string | null) => {
    const base = (slug || 'report').toLowerCase().replace(/[^a-z0-9-]/g, '-');
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = attempt === 0 ? base : `${base}-${attempt}`;
      const exists = await env.DB.prepare('SELECT 1 FROM artifact_emails WHERE email_prefix = ?')
        .bind(candidate).first();
      if (!exists) return candidate;
    }
    return `${base}-test1234`;
  },
}));

// jobs.ts now lazily provisions/deprovisions the inbox on email.received jobs.
// Stub the store so those hooks don't touch the strict DB-call sequences here.
const enableInbound = vi.hoisted(() => vi.fn());
const disableInbound = vi.hoisted(() => vi.fn());
vi.mock('../../src/email/inbox-store', () => ({ enableInbound, disableInbound }));

import {
  createArtifactEmail,
  createJob,
  deleteJob,
  getArtifactEmail,
  getNextRunTime,
  hasEnabledViewEventJob,
  invalidateViewEventJobCache,
  listJobs,
  parseCronSchedule,
  runScheduledJobs,
  updateJob,
} from '../../src/scheduling/jobs';

type DbCall =
  | { method: 'first'; result: unknown }
  | { method: 'run' }
  | { method: 'all'; results: unknown[] };

function dbEnv(calls: DbCall[], overrides: Partial<Env> = {}): Env {
  let idx = 0;
  const runSpy = vi.fn(async () => ({}));

  const db = {
    batch: vi.fn(async (stmts: unknown[]) => stmts.map(() => ({}))),
    prepare: vi.fn(() => ({
      bind: vi.fn(() => {
        const call = calls[idx++];
        if (!call) {
          throw new Error(`Unexpected DB call #${idx}`);
        }
        return {
          first: vi.fn(async () => (call.method === 'first' ? call.result : null)),
          run: runSpy,
          all: vi.fn(async () => ({
            results: call.method === 'all' ? call.results : [],
          })),
        };
      }),
    })),
  };

  return {
    DB: db,
    SHAREOUT_BASE_URL: 'https://shareout.example.com',
    EMAIL_ARTIFACTS_DOMAIN: 'mail.example.com',
    ...overrides,
  } as unknown as Env;
}

const userId = 'user_1';
const artifactId = 'art_1';

const emailJobRow = {
  id: 'job_test1234567890ab',
  artifact_id: artifactId,
  owner_id: userId,
  action: 'email',
  schedule: '0 9 * * *',
  config: JSON.stringify({ recipients: ['a@example.com'], subject: 'Hi' }),
  next_run_at: 1717063200,
  last_run_at: null,
  last_status: null,
  last_error: null,
  retry_count: 0,
  enabled: 1,
  created_at: 1717000000,
};

const webhookJobRow = {
  ...emailJobRow,
  id: 'job_webhook_test1234567890ab',
  action: 'webhook',
  config: JSON.stringify({ url: 'https://hook.example.com/hook' }),
};

beforeEach(() => {
  getUserRole.mockReset();
  checkEmailRateLimit.mockReset();
  sendArtifactEmail.mockReset();
  incrementEmailCount.mockReset();
  checkEmailRateLimit.mockResolvedValue({ allowed: true });
  sendArtifactEmail.mockResolvedValue({ success: true });
  incrementEmailCount.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('parseCronSchedule', () => {
  it('accepts valid 5-field cron expressions', () => {
    expect(parseCronSchedule('0 9 * * *')).toEqual({ valid: true });
    expect(parseCronSchedule('*/15 * * * *')).toEqual({ valid: true });
    expect(parseCronSchedule('0 9-17 * * 1-5')).toEqual({ valid: true });
    expect(parseCronSchedule('0 9,12,15 * * *')).toEqual({ valid: true });
  });

  it('rejects wrong field count', () => {
    expect(parseCronSchedule('* * *')).toEqual({
      valid: false,
      error: 'Cron must have 5 fields: minute hour day month weekday',
    });
  });

  it('rejects invalid step, range, list, and scalar values', () => {
    expect(parseCronSchedule('*/0 * * * *')).toMatchObject({ valid: false, error: expect.stringContaining('Invalid step') });
    expect(parseCronSchedule('0 25 * * *')).toMatchObject({ valid: false, error: expect.stringContaining('Invalid hour') });
    expect(parseCronSchedule('0 9 32 * *')).toMatchObject({ valid: false, error: expect.stringContaining('Invalid day') });
    expect(parseCronSchedule('0 9 * 13 *')).toMatchObject({ valid: false, error: expect.stringContaining('Invalid month') });
    expect(parseCronSchedule('0 9 * * 7')).toMatchObject({ valid: false, error: expect.stringContaining('Invalid weekday') });
    expect(parseCronSchedule('0 9-5 * * *')).toMatchObject({ valid: false, error: expect.stringContaining('Invalid range') });
    expect(parseCronSchedule('0 9,25 * * *')).toMatchObject({ valid: false, error: expect.stringContaining('Invalid value') });
  });
});

describe('getNextRunTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('returns the next matching minute for a daily schedule', () => {
    vi.setSystemTime(new Date('2026-05-30T08:30:00Z'));
    const next = getNextRunTime('0 9 * * *', new Date('2026-05-30T08:30:00Z'));
    expect(next).toBe(new Date('2026-05-30T09:00:00Z').toISOString());
  });

  it('rolls to the next day when today’s slot has passed', () => {
    vi.setSystemTime(new Date('2026-05-30T10:00:00Z'));
    const next = getNextRunTime('0 9 * * *', new Date('2026-05-30T10:00:00Z'));
    expect(next).toBe(new Date('2026-05-31T09:00:00Z').toISOString());
  });

  it('matches step and weekday specs', () => {
    vi.setSystemTime(new Date('2026-05-30T08:00:00Z')); // Friday
    const every15 = getNextRunTime('*/15 * * * *', new Date('2026-05-30T08:00:00Z'));
    expect(every15).toBe(new Date('2026-05-30T08:15:00Z').toISOString());

    const weekday = getNextRunTime('0 9 * * 1', new Date('2026-05-30T10:00:00Z'));
    expect(weekday).toBe(new Date('2026-06-01T09:00:00Z').toISOString());
  });

  it('matches hour ranges and comma lists', () => {
    vi.setSystemTime(new Date('2026-05-30T09:29:00Z'));
    const range = getNextRunTime('30 9-11 * * *', new Date('2026-05-30T09:29:00Z'));
    expect(range).toBe(new Date('2026-05-30T09:30:00Z').toISOString());

    const list = getNextRunTime('0 9,12 * * *', new Date('2026-05-30T10:00:00Z'));
    expect(list).toBe(new Date('2026-05-30T12:00:00Z').toISOString());
  });

  it('falls back when no minute matches within the search window', () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const next = getNextRunTime('0 0 31 2 *', new Date('2026-01-01T00:00:00Z'));
    expect(next).toBe(new Date(Date.parse('2026-01-01T00:00:00Z') + 86400 * 1000).toISOString());
  });

  it('handles a list combined with a range in one field', () => {
    // 12h list + range: hours {1} ∪ {10..12}. From 02:00 the next match is 10:00,
    // not 03:00 (the buggy range-first parse read "1,10" as hour 1).
    const next = getNextRunTime('0 1,10-12 * * *', new Date('2026-05-30T02:00:00Z'));
    expect(next).toBe(new Date('2026-05-30T10:00:00Z').toISOString());
  });

  it('bounds a range/step combo by the range end', () => {
    // minute 1-5/2 → {1,3,5} only. From 05:06 the next match is 06:01; the buggy
    // step parser ignored the "-5" bound and would fire at 05:07.
    const next = getNextRunTime('1-5/2 * * * *', new Date('2026-05-30T05:06:00Z'));
    expect(next).toBe(new Date('2026-05-30T06:01:00Z').toISOString());
  });

  it('ORs day-of-month and day-of-week when both are restricted', () => {
    // `0 9 13 * 5`: standard cron fires on the 13th OR any Friday, not only
    // Friday-the-13th. 2026-06-01 is a Monday; the 5th is the first Friday.
    const next = getNextRunTime('0 9 13 * 5', new Date('2026-06-01T00:00:00Z'));
    expect(next).toBe(new Date('2026-06-05T09:00:00Z').toISOString());
  });
});

describe('createJob', () => {
  it('rejects invalid cron before hitting the database', async () => {
    const env = dbEnv([]);
    const result = await createJob(env, userId, {
      artifact_id: artifactId,
      action: 'email',
      schedule: 'bad cron',
      config: { recipients: ['a@example.com'], subject: 'Hi' },
    });
    expect(result).toEqual({ error: 'Cron must have 5 fields: minute hour day month weekday' });
    expect(env.DB.prepare).not.toHaveBeenCalled();
  });

  it('rejects missing artifact', async () => {
    const env = dbEnv([{ method: 'first', result: null }]);
    const result = await createJob(env, userId, {
      artifact_id: 'art_missing',
      action: 'email',
      schedule: '0 9 * * *',
      config: { recipients: ['a@example.com'], subject: 'Hi' },
    });
    expect(result).toEqual({ error: 'Artifact not found' });
  });

  it('rejects viewers scheduling non-self delivery, and missing roles', async () => {
    // Viewer scheduling email to someone other than their own account → rejected.
    getUserRole.mockResolvedValueOnce('viewer');
    expect((await createJob(
      dbEnv([
        { method: 'first', result: { id: artifactId } },
        { method: 'first', result: { email: 'viewer@example.com' } },
      ]),
      userId,
      {
        artifact_id: artifactId,
        action: 'email',
        schedule: '0 9 * * *',
        config: { recipients: ['a@example.com'], subject: 'Hi' },
      }
    )).error).toContain('their own account address');

    getUserRole.mockResolvedValueOnce(null);
    expect((await createJob(
      dbEnv([{ method: 'first', result: { id: artifactId } }]),
      userId,
      {
        artifact_id: artifactId,
        action: 'email',
        schedule: '0 9 * * *',
        config: { recipients: ['a@example.com'], subject: 'Hi' },
      }
    )).error).toContain('Permission denied');
  });

  it('allows a viewer to schedule a Slack DM to themselves', async () => {
    getUserRole.mockResolvedValueOnce('viewer');
    const env = dbEnv([
      { method: 'first', result: { id: artifactId } },
      { method: 'first', result: { count: 0 } },
      { method: 'run' },
      { method: 'run' },
      { method: 'first', result: { id: 'job_test1234567890ab', config: '{}' } },
    ]);
    const result = await createJob(env, userId, {
      artifact_id: artifactId,
      action: 'slack',
      schedule: '0 9 * * *',
      config: { connection: 'team', targetType: 'dm', slackUserId: 'U123' },
    });
    expect(result.error).toBeUndefined();
    expect(result.job).toBeDefined();
  });

  it('enforces daily job limit', async () => {
    const env = dbEnv([
      { method: 'first', result: { id: artifactId } },
      { method: 'first', result: { count: 5 } },
    ]);
    getUserRole.mockResolvedValueOnce('owner');
    const result = await createJob(env, userId, {
      artifact_id: artifactId,
      action: 'email',
      schedule: '0 9 * * *',
      config: { recipients: ['a@example.com'], subject: 'Hi' },
    });
    expect(result).toEqual({ error: 'Job limit reached (5 per user)' });
  });

  it('validates email recipients', async () => {
    const baseCalls: DbCall[] = [
      { method: 'first', result: { id: artifactId } },
      { method: 'first', result: { count: 0 } },
    ];
    getUserRole.mockResolvedValue('editor');

    const missing = await createJob(dbEnv(baseCalls), userId, {
      artifact_id: artifactId,
      action: 'email',
      schedule: '0 9 * * *',
      config: { recipients: [], subject: 'Hi' },
    });
    expect(missing).toEqual({ error: 'Email recipients required' });

    const tooMany = await createJob(dbEnv(baseCalls), userId, {
      artifact_id: artifactId,
      action: 'email',
      schedule: '0 9 * * *',
      config: { recipients: Array.from({ length: 11 }, (_, i) => `u${i}@example.com`), subject: 'Hi' },
    });
    expect(tooMany).toEqual({ error: 'Maximum 10 recipients per email' });

    const invalid = await createJob(dbEnv(baseCalls), userId, {
      artifact_id: artifactId,
      action: 'email',
      schedule: '0 9 * * *',
      config: { recipients: ['not-an-email'], subject: 'Hi' },
    });
    expect(invalid).toEqual({ error: 'Invalid email: not-an-email' });
  });

  it('validates webhook URL', async () => {
    const baseCalls: DbCall[] = [
      { method: 'first', result: { id: artifactId } },
      { method: 'first', result: { count: 0 } },
    ];
    getUserRole.mockResolvedValue('owner');

    expect((await createJob(dbEnv(baseCalls), userId, {
      artifact_id: artifactId,
      action: 'webhook',
      schedule: '0 9 * * *',
      config: { url: '' },
    })).error).toBe('Webhook URL required');

    expect((await createJob(dbEnv(baseCalls), userId, {
      artifact_id: artifactId,
      action: 'webhook',
      schedule: '0 9 * * *',
      config: { url: 'http://insecure.example.com' },
    })).error).toBe('Webhook URL must use HTTPS');

    expect((await createJob(dbEnv(baseCalls), userId, {
      artifact_id: artifactId,
      action: 'webhook',
      schedule: '0 9 * * *',
      config: { url: 'not-a-url' },
    })).error).toBe('Invalid webhook URL');
  });

  it('creates a webhook job', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-30T08:00:00Z'));

    const env = dbEnv([
      { method: 'first', result: { id: artifactId } },
      { method: 'first', result: { count: 0 } },
      { method: 'run' },
      { method: 'run' },
      {
        method: 'first',
        result: {
          ...webhookJobRow,
          config: JSON.stringify({ url: 'https://hook.example.com/hook', method: 'PUT' }),
        },
      },
    ]);
    getUserRole.mockResolvedValueOnce('editor');

    const result = await createJob(env, userId, {
      artifact_id: artifactId,
      action: 'webhook',
      schedule: '0 9 * * *',
      config: { url: 'https://hook.example.com/hook', method: 'PUT' },
    });

    expect(result.job).toMatchObject({
      action: 'webhook',
      config: { url: 'https://hook.example.com/hook', method: 'PUT' },
    });
  });

  it('creates an email job and increments rate limit', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-30T08:00:00Z'));

    const env = dbEnv([
      { method: 'first', result: { id: artifactId } },
      { method: 'first', result: { count: 2 } },
      { method: 'run' },
      { method: 'run' },
      { method: 'first', result: emailJobRow },
    ]);
    getUserRole.mockResolvedValueOnce('owner');

    const result = await createJob(env, userId, {
      artifact_id: artifactId,
      action: 'email',
      schedule: '0 9 * * *',
      config: { recipients: ['a@example.com'], subject: 'Hi' },
    });

    expect(result.job).toMatchObject({
      id: 'job_test1234567890ab',
      artifact_id: artifactId,
      owner_id: userId,
      action: 'email',
      config: { recipients: ['a@example.com'], subject: 'Hi' },
    });
    expect(env.DB.prepare).toHaveBeenCalledTimes(5);
  });
});

describe('listJobs', () => {
  it('returns parsed jobs for the owner', async () => {
    const env = dbEnv([
      {
        method: 'all',
        results: [
          emailJobRow,
          {
            ...emailJobRow,
            id: 'job_2',
            config: JSON.stringify({ url: 'https://hook.example.com' }),
            action: 'webhook',
            enabled: 0,
          },
        ],
      },
    ]);

    const jobs = await listJobs(env, userId);
    expect(jobs).toHaveLength(2);
    expect(jobs[0].config).toEqual({ recipients: ['a@example.com'], subject: 'Hi' });
    expect(jobs[1].enabled).toBe(false);
  });

  it('filters by artifact when requested', async () => {
    const env = dbEnv([{ method: 'all', results: [emailJobRow] }]);
    await listJobs(env, userId, artifactId);
    expect(env.DB.prepare).toHaveBeenCalledWith(expect.stringContaining('artifact_id = ?'));
  });
});

describe('deleteJob', () => {
  it('returns not found for missing jobs', async () => {
    const env = dbEnv([{ method: 'first', result: null }]);
    expect(await deleteJob(env, userId, 'job_missing')).toEqual({
      success: false,
      error: 'Job not found',
    });
  });

  it('denies non-owners', async () => {
    const env = dbEnv([{ method: 'first', result: { owner_id: 'other_user' } }]);
    expect(await deleteJob(env, userId, 'job_1')).toEqual({
      success: false,
      error: 'Permission denied',
    });
  });

  it('deletes owned jobs', async () => {
    const env = dbEnv([
      { method: 'first', result: { owner_id: userId } },
      { method: 'run' },
    ]);
    expect(await deleteJob(env, userId, 'job_1')).toEqual({ success: true });
    expect(env.DB.prepare).toHaveBeenCalledTimes(2);
  });
});

describe('email.received inbox provisioning', () => {
  beforeEach(() => {
    enableInbound.mockClear();
    disableInbound.mockClear();
  });

  it('enables the inbox when the first email.received trigger is created', async () => {
    const env = dbEnv([
      { method: 'first', result: { id: artifactId, workspace_id: 'ws_1' } },
      { method: 'first', result: { count: 0 } },
      { method: 'run' },
      { method: 'run' },
      { method: 'first', result: { id: 'job_test1234567890ab', config: '{}' } },
    ]);
    getUserRole.mockResolvedValueOnce('owner');
    const result = await createJob(env, userId, {
      artifact_id: artifactId,
      action: 'webhook',
      trigger_type: 'event',
      event_type: 'email.received',
      config: { url: 'https://example.com/hook' },
    });
    expect(result.error).toBeUndefined();
    expect(enableInbound).toHaveBeenCalledWith(env, artifactId);
  });

  it('disables the inbox when the last email.received trigger is deleted', async () => {
    const env = dbEnv([
      { method: 'first', result: { owner_id: userId, artifact_id: artifactId, trigger_type: 'event', event_type: 'email.received' } },
      { method: 'run' },
      { method: 'first', result: { n: 0 } },
    ]);
    expect(await deleteJob(env, userId, 'job_1')).toEqual({ success: true });
    expect(disableInbound).toHaveBeenCalledWith(env, artifactId);
  });

  it('keeps the inbox when other email.received triggers remain', async () => {
    const env = dbEnv([
      { method: 'first', result: { owner_id: userId, artifact_id: artifactId, trigger_type: 'event', event_type: 'email.received' } },
      { method: 'run' },
      { method: 'first', result: { n: 2 } },
    ]);
    await deleteJob(env, userId, 'job_1');
    expect(disableInbound).not.toHaveBeenCalled();
  });
});

describe('updateJob', () => {
  it('returns not found and permission errors', async () => {
    const env = dbEnv([{ method: 'first', result: null }]);
    expect((await updateJob(env, userId, 'job_1', { enabled: false })).error).toBe('Job not found');

    const denied = dbEnv([{ method: 'first', result: { ...emailJobRow, owner_id: 'other' } }]);
    expect((await updateJob(denied, userId, 'job_1', { enabled: false })).error).toBe('Permission denied');
  });

  it('rejects empty updates and invalid cron', async () => {
    const base = dbEnv([{ method: 'first', result: emailJobRow }]);
    expect((await updateJob(base, userId, emailJobRow.id, {})).error).toBe('No updates provided');

    const badCron = dbEnv([{ method: 'first', result: emailJobRow }]);
    expect((await updateJob(badCron, userId, emailJobRow.id, { schedule: 'bad' })).error)
      .toContain('Cron must have 5 fields');
  });

  it('updates enabled, schedule, and config', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-30T08:00:00Z'));

    const updatedRow = {
      ...emailJobRow,
      enabled: 0,
      schedule: '0 10 * * *',
      config: JSON.stringify({ recipients: ['b@example.com'], subject: 'Updated' }),
    };
    const env = dbEnv([
      { method: 'first', result: emailJobRow },
      { method: 'run' },
      { method: 'first', result: updatedRow },
    ]);

    const result = await updateJob(env, userId, emailJobRow.id, {
      enabled: false,
      schedule: '0 10 * * *',
      config: { recipients: ['b@example.com'], subject: 'Updated' },
    });

    expect(result.job).toMatchObject({
      enabled: 0,
      schedule: '0 10 * * *',
      config: { recipients: ['b@example.com'], subject: 'Updated' },
    });
    expect(env.DB.prepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE scheduled_jobs'));
  });
});

describe('createArtifactEmail', () => {
  const artifact = { id: artifactId, name: 'Report', slug: 'q4-report' };

  it('returns existing email when already provisioned', async () => {
    const env = dbEnv([
      { method: 'first', result: artifact },
      { method: 'first', result: { email_prefix: 'report' } },
    ]);
    getUserRole.mockResolvedValueOnce('editor');

    const result = await createArtifactEmail(env, userId, artifactId);
    expect(result).toEqual({ email: 'report@mail.example.com' });
  });

  it('creates a new artifact email with slug-based prefix', async () => {
    const env = dbEnv([
      { method: 'first', result: artifact },
      { method: 'first', result: null },
      { method: 'first', result: null },
      { method: 'run' },
    ]);
    getUserRole.mockResolvedValueOnce('owner');

    const result = await createArtifactEmail(env, userId, artifactId, 'owner@example.com');
    expect(result).toEqual({ email: 'q4-report@mail.example.com' });
  });

  it('rejects missing artifacts and unauthorized users', async () => {
    const env = dbEnv([{ method: 'first', result: null }]);
    expect((await createArtifactEmail(env, userId, 'art_missing')).error).toBe('Artifact not found');

    const denied = dbEnv([{ method: 'first', result: artifact }]);
    getUserRole.mockResolvedValueOnce('viewer');
    expect((await createArtifactEmail(denied, userId, artifactId)).error).toContain('Permission denied');
  });

  it('uses suffixed prefix when the slug prefix is taken', async () => {
    const env = dbEnv([
      { method: 'first', result: artifact },
      { method: 'first', result: null },
      { method: 'first', result: { 1: true } },
      { method: 'first', result: null },
      { method: 'run' },
    ]);
    getUserRole.mockResolvedValueOnce('owner');

    const result = await createArtifactEmail(env, userId, artifactId);
    expect(result).toEqual({ email: 'q4-report-1@mail.example.com' });
  });

  it('falls back to a generated suffix after ten collisions', async () => {
    const collisionChecks = Array.from({ length: 10 }, () => ({
      method: 'first' as const,
      result: { 1: true },
    }));
    const env = dbEnv([
      { method: 'first', result: artifact },
      { method: 'first', result: null },
      ...collisionChecks,
      { method: 'run' },
    ]);
    getUserRole.mockResolvedValueOnce('owner');

    const result = await createArtifactEmail(env, userId, artifactId);
    expect(result.email).toBe('q4-report-test1234@mail.example.com');
  });
});

describe('runScheduledJobs', () => {
  const artifact = { id: artifactId, name: 'Report', slug: 'q4-report' };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-30T09:05:00Z'));
    // Per-run access recheck: the job creator still has access to the artifact.
    getUserRole.mockResolvedValue('owner');
  });

  it('returns zero counts when no jobs are due', async () => {
    const env = dbEnv([{ method: 'all', results: [] }]);
    expect(await runScheduledJobs(env)).toEqual({ executed: 0, failed: 0 });
  });

  it('executes a successful email job and increments email count', async () => {
    const env = dbEnv([
      { method: 'all', results: [emailJobRow] },
      { method: 'run' },
      { method: 'run' },
      { method: 'run' },
    ]);

    const result = await runScheduledJobs(env);

    expect(result).toEqual({ executed: 1, failed: 0 });
    expect(checkEmailRateLimit).toHaveBeenCalledWith(env, userId, artifactId);
    expect(sendArtifactEmail).toHaveBeenCalledWith(env, artifactId, {
      recipients: ['a@example.com'],
      subject: 'Hi',
    });
    expect(incrementEmailCount).toHaveBeenCalledWith(env, userId, artifactId);
  });

  it('fails email jobs when rate limited', async () => {
    checkEmailRateLimit.mockResolvedValueOnce({ allowed: false });
    const env = dbEnv([
      { method: 'all', results: [emailJobRow] },
      { method: 'run' },
      { method: 'run' },
      { method: 'run' },
    ]);

    const result = await runScheduledJobs(env);

    expect(result).toEqual({ executed: 0, failed: 1 });
    expect(sendArtifactEmail).not.toHaveBeenCalled();
    expect(incrementEmailCount).not.toHaveBeenCalled();
  });

  it('retries a failed email job once then schedules the next cron run', async () => {
    sendArtifactEmail.mockResolvedValueOnce({ success: false, error: 'SMTP down' });
    const env = dbEnv([
      { method: 'all', results: [{ ...emailJobRow, retry_count: 0, max_attempts: 2 }] },
      { method: 'run' },
      { method: 'run' },
      { method: 'run' },
    ]);

    expect(await runScheduledJobs(env)).toEqual({ executed: 0, failed: 1 });
    expect(env.DB.prepare).toHaveBeenCalledWith(expect.stringContaining('retry_count = retry_count + 1'));
  });

  it('does not retry when retry_count is already exhausted', async () => {
    sendArtifactEmail.mockResolvedValueOnce({ success: false, error: 'SMTP down' });
    const env = dbEnv([
      { method: 'all', results: [{ ...emailJobRow, retry_count: 1 }] },
      { method: 'run' },
      { method: 'run' },
      { method: 'run' },
    ]);

    expect(await runScheduledJobs(env)).toEqual({ executed: 0, failed: 1 });
    expect(env.DB.prepare).toHaveBeenCalledWith(expect.stringContaining('retry_count = 0, next_run_at'));
  });

  it('records execution errors from thrown email sends', async () => {
    sendArtifactEmail.mockRejectedValueOnce(new Error('boom'));
    const env = dbEnv([
      { method: 'all', results: [emailJobRow] },
      { method: 'run' },
      { method: 'run' },
      { method: 'run' },
    ]);

    expect(await runScheduledJobs(env)).toEqual({ executed: 0, failed: 1 });
  });

  it('executes a successful webhook with artifact payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const env = dbEnv([
      { method: 'all', results: [webhookJobRow] },
      { method: 'first', result: artifact },
      { method: 'run' },
      { method: 'run' },
      { method: 'run' },
    ]);

    expect(await runScheduledJobs(env)).toEqual({ executed: 1, failed: 0 });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://hook.example.com/hook',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'User-Agent': 'ShareOut-Webhook/1.0',
        }),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toMatchObject({
      artifact_id: artifactId,
      artifact_name: 'Report',
      artifact_url: 'https://shareout.example.com/a/q4-report/',
    });
  });

  it('includes artifact JSON data when configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const jobWithData = {
      ...webhookJobRow,
      config: JSON.stringify({
        url: 'https://hook.example.com/hook',
        includeArtifactData: true,
        method: 'PATCH',
        headers: { 'X-Custom': '1' },
      }),
    };
    const env = dbEnv([
      { method: 'all', results: [jobWithData] },
      { method: 'first', result: artifact },
      { method: 'all', results: [{ key: 'kpi', value: '{"value":42}' }] },
      { method: 'run' },
      { method: 'run' },
      { method: 'run' },
    ]);

    await runScheduledJobs(env);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.data).toEqual({ kpi: { value: 42 } });
    expect(fetchMock.mock.calls[0][1].method).toBe('PATCH');
    expect(fetchMock.mock.calls[0][1].headers['X-Custom']).toBe('1');
  });

  it('fails webhooks when artifact or HTTP response is missing', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    vi.stubGlobal('fetch', fetchMock);

    const missingArtifact = dbEnv([
      { method: 'all', results: [webhookJobRow] },
      { method: 'first', result: null },
      { method: 'run' },
      { method: 'run' },
      { method: 'run' },
    ]);
    expect(await runScheduledJobs(missingArtifact)).toEqual({ executed: 0, failed: 1 });

    const badResponse = dbEnv([
      { method: 'all', results: [webhookJobRow] },
      { method: 'first', result: artifact },
      { method: 'run' },
      { method: 'run' },
      { method: 'run' },
    ]);
    expect(await runScheduledJobs(badResponse)).toEqual({ executed: 0, failed: 1 });
    expect(fetchMock).toHaveBeenCalled();
  });

  it('fails webhooks when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const env = dbEnv([
      { method: 'all', results: [webhookJobRow] },
      { method: 'first', result: artifact },
      { method: 'run' },
      { method: 'run' },
      { method: 'run' },
    ]);

    expect(await runScheduledJobs(env)).toEqual({ executed: 0, failed: 1 });
  });
});

describe('getArtifactEmail', () => {
  it('returns null when no email is configured', async () => {
    const env = dbEnv([{ method: 'first', result: null }]);
    expect(await getArtifactEmail(env, artifactId)).toBeNull();
  });

  it('returns the formatted address when configured', async () => {
    const env = dbEnv([{ method: 'first', result: { email_prefix: 'dashboard' } }]);
    expect(await getArtifactEmail(env, artifactId)).toBe('dashboard@mail.example.com');
  });
});

describe('hasEnabledViewEventJob', () => {
  function kvMock(initial: Record<string, string> = {}) {
    const store = new Map<string, string>(Object.entries(initial));
    return {
      store,
      get: vi.fn(async (k: string) => store.get(k) ?? null),
      put: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
      delete: vi.fn(async (k: string) => { store.delete(k); }),
    };
  }

  function envWith(kv: ReturnType<typeof kvMock> | undefined, dbFirst: unknown): { env: Env; first: ReturnType<typeof vi.fn> } {
    const first = vi.fn(async () => dbFirst);
    const db = { prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first })) })) };
    return { env: { DB: db, PROXY_CACHE: kv } as unknown as Env, first };
  }

  it('returns cached negative without hitting D1', async () => {
    const kv = kvMock({ 'evtjobs:view:art_1': '0' });
    const { env, first } = envWith(kv, { 1: 1 });
    expect(await hasEnabledViewEventJob(env, 'art_1')).toBe(false);
    expect(first).not.toHaveBeenCalled();
  });

  it('returns cached positive without hitting D1', async () => {
    const kv = kvMock({ 'evtjobs:view:art_1': '1' });
    const { env, first } = envWith(kv, null);
    expect(await hasEnabledViewEventJob(env, 'art_1')).toBe(true);
    expect(first).not.toHaveBeenCalled();
  });

  it('falls through to D1 on miss and caches the result', async () => {
    const kv = kvMock();
    const { env, first } = envWith(kv, { 1: 1 });
    expect(await hasEnabledViewEventJob(env, 'art_1')).toBe(true);
    expect(first).toHaveBeenCalled();
    expect(kv.put).toHaveBeenCalledWith('evtjobs:view:art_1', '1', { expirationTtl: 3600 });
  });

  it('caches a negative result on miss', async () => {
    const kv = kvMock();
    const { env } = envWith(kv, null);
    expect(await hasEnabledViewEventJob(env, 'art_1')).toBe(false);
    expect(kv.store.get('evtjobs:view:art_1')).toBe('0');
  });

  it('queries D1 directly when no KV is bound', async () => {
    const { env, first } = envWith(undefined, { 1: 1 });
    expect(await hasEnabledViewEventJob(env, 'art_1')).toBe(true);
    expect(first).toHaveBeenCalled();
  });

  it('invalidate deletes the cache key', async () => {
    const kv = kvMock({ 'evtjobs:view:art_1': '1' });
    await invalidateViewEventJobCache({ PROXY_CACHE: kv } as unknown as Env, 'art_1');
    expect(kv.delete).toHaveBeenCalledWith('evtjobs:view:art_1');
    expect(kv.store.has('evtjobs:view:art_1')).toBe(false);
  });
});
