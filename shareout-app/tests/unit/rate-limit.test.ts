import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkAccountCreation,
  checkAiChatLimit,
  checkKVRateLimit,
  checkSlidingWindowRateLimit,
  getClientIp,
  rateLimitHeaders,
  rateLimitResponse,
} from '../../src/rate-limit';
import type { Env } from '../../src/types';

function kvEnv(store = new Map<string, string>()): Env {
  return {
    RATE_LIMIT_KV: {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => { store.set(key, value); },
    },
  } as unknown as Env;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getClientIp', () => {
  it('prefers cf-connecting-ip over x-forwarded-for', () => {
    const request = new Request('https://shareout.site/v1/publish', {
      headers: {
        'cf-connecting-ip': '1.2.3.4',
        'x-forwarded-for': '9.9.9.9, 8.8.8.8',
      },
    });

    expect(getClientIp(request)).toBe('1.2.3.4');
  });

  it('falls back to the first x-forwarded-for hop or unknown', () => {
    expect(getClientIp(new Request('https://shareout.site', {
      headers: { 'x-forwarded-for': ' 10.0.0.1 , 10.0.0.2' },
    }))).toBe('10.0.0.1');

    expect(getClientIp(new Request('https://shareout.site'))).toBe('unknown');
  });
});

describe('checkSlidingWindowRateLimit', () => {
  it('allows all requests when KV is unavailable', async () => {
    const result = await checkSlidingWindowRateLimit(undefined, 'user_1', 'publish');

    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(30);
    expect(result.remaining).toBe(30);
    expect(typeof result.reset).toBe('number');
  });

  it('tracks usage in KV and enforces limits', async () => {
    const store = new Map<string, string>();
    const kv = {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => { store.set(key, value); },
    } as KVNamespace;

    const first = await checkSlidingWindowRateLimit(kv, 'user_2', 'accountCreate');
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(0);

    const second = await checkSlidingWindowRateLimit(kv, 'user_2', 'accountCreate');
    expect(second.allowed).toBe(false);
    expect(second.remaining).toBe(0);
    expect(second.retryAfter).toBeGreaterThan(0);
  });

  it('includes counts from the previous window', async () => {
    const now = 1_700_000_030;
    vi.spyOn(Date, 'now').mockReturnValue(now * 1000);

    const windowStart = Math.floor(now / 60) * 60;
    const prevWindowStart = windowStart - 60;
    const store = new Map<string, string>([
      [`rl:anonymous:user_3:${prevWindowStart}`, '80'],
    ]);
    const kv = {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => { store.set(key, value); },
    } as KVNamespace;

    const result = await checkSlidingWindowRateLimit(kv, 'user_3', 'anonymous');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeLessThan(100);
  });
});

describe('rateLimitHeaders and rateLimitResponse', () => {
  it('builds standard rate limit headers', () => {
    expect(rateLimitHeaders({
      allowed: false,
      limit: 100,
      remaining: 0,
      reset: 1_700_000_000,
      retryAfter: 42,
    })).toEqual({
      'X-RateLimit-Limit': '100',
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': '1700000000',
      'Retry-After': '42',
    });
  });

  it('omits Retry-After when not set', () => {
    expect(rateLimitHeaders({
      allowed: true,
      limit: 100,
      remaining: 99,
      reset: 1_700_000_000,
    })).toEqual({
      'X-RateLimit-Limit': '100',
      'X-RateLimit-Remaining': '99',
      'X-RateLimit-Reset': '1700000000',
    });
  });

  it('returns a 429 JSON response', async () => {
    const response = rateLimitResponse({
      allowed: false,
      limit: 5,
      remaining: 0,
      reset: 1_700_000_000,
      retryAfter: 10,
    });

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Rate limit reached (max 5 per window). Try again in about 1 minute.',
      code: 'RATE_LIMIT_EXCEEDED',
      limit: 5,
      retryAfter: 10,
    });
  });
});

describe('env rate limit wrappers', () => {
  it('delegates through checkKVRateLimit and action-specific helpers', async () => {
    const env = kvEnv();

    await expect(checkKVRateLimit(env.RATE_LIMIT_KV, 'id', 'publish')).resolves.toMatchObject({
      allowed: true,
      limit: 30,
    });
    await expect(checkAccountCreation(env, '1.2.3.4')).resolves.toMatchObject({
      allowed: true,
      limit: 1,
    });
    await expect(checkAiChatLimit(env, 'user_1')).resolves.toMatchObject({
      allowed: true,
      limit: 100,
    });
  });
});

describe('auth / access / bridge helpers', () => {
  it('enforces emailOtpStart per IP', async () => {
    const env = kvEnv();
    const req = new Request('https://shareout.example.com/v1/auth/email/start', {
      headers: { 'cf-connecting-ip': '203.0.113.9' },
    });
    const { checkEmailOtpStartLimit } = await import('../../src/rate-limit');
    for (let i = 0; i < 20; i++) {
      expect((await checkEmailOtpStartLimit(env, req)).allowed).toBe(true);
    }
    expect((await checkEmailOtpStartLimit(env, req)).allowed).toBe(false);
  });

  it('enforces accessRequest per user id', async () => {
    const env = kvEnv();
    const { checkAccessRequestLimit } = await import('../../src/rate-limit');
    for (let i = 0; i < 30; i++) {
      expect((await checkAccessRequestLimit(env, 'usr_1')).allowed).toBe(true);
    }
    expect((await checkAccessRequestLimit(env, 'usr_1')).allowed).toBe(false);
  });
});
