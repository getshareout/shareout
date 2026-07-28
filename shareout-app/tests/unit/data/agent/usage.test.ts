// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkRateLimit,
  getUsage,
  incrementRateLimit,
  recordError,
  recordUsage,
} from '../../../../src/data/agent/usage';
import { ARTIFACT_ID, makeEnv } from './helpers';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('recordUsage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-30T12:00:00Z'));
  });

  it('upserts token usage for the current month', async () => {
    const run = vi.fn(async () => ({ success: true }));
    const env = makeEnv({ run });

    await recordUsage(env, ARTIFACT_ID, 'visitor', 100, 50);

    expect(run).toHaveBeenCalledTimes(1);
    const [sql, args] = run.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO agent_usage');
    expect(sql).toContain('ON CONFLICT');
    expect(args).toEqual(expect.arrayContaining([ARTIFACT_ID, 'visitor', '2026-05', 100, 50]));
    expect(String(args[0])).toMatch(/^usg_/);
  });
});

describe('recordError', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-30T12:00:00Z'));
  });

  it('increments error_count for the current month', async () => {
    const run = vi.fn(async () => ({ success: true }));
    const env = makeEnv({ run });

    await recordError(env, ARTIFACT_ID, 'admin');

    const [sql, args] = run.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('error_count');
    expect(args).toEqual(expect.arrayContaining([ARTIFACT_ID, 'admin', '2026-05']));
  });
});

describe('getUsage', () => {
  it('returns visitor, admin, and pilot usage for the default period', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-15T00:00:00Z'));

    const env = makeEnv({
      all: () => ({
        results: [
          { mode: 'visitor', input_tokens: 10, output_tokens: 5, request_count: 2, error_count: 0 },
          { mode: 'admin', input_tokens: 20, output_tokens: 8, request_count: 1, error_count: 1 },
          { mode: 'pilot', input_tokens: 30, output_tokens: 12, request_count: 3, error_count: 0 },
          { mode: 'unknown', input_tokens: 99, output_tokens: 99, request_count: 99, error_count: 99 },
        ],
      }),
    });

    const usage = await getUsage(env, ARTIFACT_ID);

    expect(usage.visitor).toEqual({
      input_tokens: 10,
      output_tokens: 5,
      request_count: 2,
      error_count: 0,
    });
    expect(usage.admin).toEqual({
      input_tokens: 20,
      output_tokens: 8,
      request_count: 1,
      error_count: 1,
    });
    expect(usage.pilot).toEqual({
      input_tokens: 30,
      output_tokens: 12,
      request_count: 3,
      error_count: 0,
    });
  });

  it('honors an explicit period query', async () => {
    const env = makeEnv({
      all: (_sql, args) => {
        expect(args).toEqual([ARTIFACT_ID, '2026-04']);
        return { results: [] };
      },
    });

    const usage = await getUsage(env, ARTIFACT_ID, '2026-04');
    expect(usage).toEqual({ visitor: null, admin: null, pilot: null });
  });
});

describe('checkRateLimit', () => {
  const minuteKey = '2026-05-30T12:00';
  const dayKey = '2026-05-30';

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-30T12:00:30Z'));
  });

  function rows(...counts: Array<{ action: string; count: number }>) {
    return () => ({ results: counts });
  }

  it('allows and reads zero when no counter rows exist for the current windows', async () => {
    const env = makeEnv({ all: rows() });

    const result = await checkRateLimit(env, ARTIFACT_ID);

    expect(result).toEqual({ allowed: true, remaining: 9 });
  });

  it('scopes the read to this minute and this day', async () => {
    const env = makeEnv({ all: rows() });

    await checkRateLimit(env, ARTIFACT_ID);

    const [sql] = (env.DB.prepare as unknown as { mock: { calls: [string][] } }).mock.calls[0];
    expect(sql).toContain("principal_type = 'artifact'");
    const bind = (env.DB.prepare as unknown as { mock: { results: { value: { bind: { mock: { calls: unknown[][] } } } }[] } })
      .mock.results[0].value.bind.mock.calls[0];
    expect(bind).toEqual([ARTIFACT_ID, minuteKey, dayKey]);
  });

  it('denies when the per-minute request cap is reached', async () => {
    const env = makeEnv({ all: rows({ action: 'agent_requests', count: 10 }) });

    const result = await checkRateLimit(env, ARTIFACT_ID);

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it('denies when estimated tokens exceed the daily budget', async () => {
    const env = makeEnv({ all: rows({ action: 'agent_tokens', count: 99990 }) });

    const result = await checkRateLimit(env, ARTIFACT_ID, 20);

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(10);
    expect(result.retryAfter).toBeGreaterThan(0);
  });
});

describe('incrementRateLimit', () => {
  it('upserts the minute request counter and the day token counter', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-30T12:00:00Z'));

    const env = makeEnv();

    await incrementRateLimit(env, ARTIFACT_ID, 250);

    const prepare = env.DB.prepare as unknown as {
      mock: { calls: [string][]; results: { value: { bind: { mock: { calls: unknown[][] } } } }[] };
    };
    expect(env.DB.batch).toHaveBeenCalledTimes(1);
    expect(prepare.mock.calls[0][0]).toContain("'agent_requests'");
    expect(prepare.mock.results[0].value.bind.mock.calls[0]).toEqual([ARTIFACT_ID, '2026-05-30T12:00']);
    expect(prepare.mock.calls[1][0]).toContain("'agent_tokens'");
    expect(prepare.mock.results[1].value.bind.mock.calls[0]).toEqual([ARTIFACT_ID, '2026-05-30', 250]);
  });
});
