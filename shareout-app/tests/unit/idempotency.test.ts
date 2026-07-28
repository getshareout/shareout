import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkIdempotencyKey,
  getIdempotencyKey,
  idempotencyResultToResponse,
  storeIdempotencyResult,
  withIdempotency,
} from '../../src/idempotency';
import type { Env } from '../../src/types';

function kvEnv(store = new Map<string, string>()): Env {
  return {
    RATE_LIMIT_KV: {
      get: vi.fn(async (key: string, type?: string) => {
        const value = store.get(key);
        if (!value) return null;
        return type === 'json' ? JSON.parse(value) : value;
      }),
      put: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
      }),
    },
  } as unknown as Env;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getIdempotencyKey', () => {
  it('reads X-Idempotency-Key or Idempotency-Key headers', () => {
    expect(getIdempotencyKey(new Request('https://shareout.site/v1/publish', {
      headers: { 'X-Idempotency-Key': 'key-a' },
    }))).toBe('key-a');

    expect(getIdempotencyKey(new Request('https://shareout.site/v1/publish', {
      headers: { 'Idempotency-Key': 'key-b' },
    }))).toBe('key-b');

    expect(getIdempotencyKey(new Request('https://shareout.site/v1/publish'))).toBeNull();
  });
});

describe('checkIdempotencyKey', () => {
  it('returns null when key or KV is missing', async () => {
    await expect(checkIdempotencyKey({} as Env, null)).resolves.toBeNull();
    await expect(checkIdempotencyKey({} as Env, 'abc')).resolves.toBeNull();
  });

  it('returns cached results from KV', async () => {
    const cached = { status: 201, body: '{"ok":true}', headers: { 'Content-Type': 'application/json' } };
    const env = kvEnv(new Map([['idem:publish-1', JSON.stringify(cached)]]));
    await expect(checkIdempotencyKey(env, 'publish-1')).resolves.toEqual(cached);
  });
});

describe('storeIdempotencyResult', () => {
  it('no-ops when key or KV is missing', async () => {
    const response = new Response('ok', { status: 200 });
    await expect(storeIdempotencyResult({} as Env, null, response)).resolves.toBeUndefined();
    await expect(storeIdempotencyResult({} as Env, 'key', response)).resolves.toBeUndefined();
  });

  it('persists response body and strips cf-* headers', async () => {
    const store = new Map<string, string>();
    const env = kvEnv(store);
    const response = new Response('{"id":"art_1"}', {
      status: 201,
      headers: {
        'Content-Type': 'application/json',
        'cf-ray': 'abc123',
      },
    });

    await storeIdempotencyResult(env, 'publish-2', response);

    const saved = JSON.parse(store.get('idem:publish-2')!);
    expect(saved.status).toBe(201);
    expect(saved.body).toBe('{"id":"art_1"}');
    expect(saved.headers['content-type'] ?? saved.headers['Content-Type']).toBe('application/json');
    expect(saved.headers['cf-ray']).toBeUndefined();
  });
});

describe('idempotencyResultToResponse', () => {
  it('replays cached responses with X-Idempotent-Replayed', async () => {
    const response = idempotencyResultToResponse({
      status: 200,
      body: '{"cached":true}',
      headers: { 'Content-Type': 'application/json' },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Idempotent-Replayed')).toBe('true');
    await expect(response.json()).resolves.toEqual({ cached: true });
  });
});

describe('withIdempotency', () => {
  it('runs the handler when no idempotency key is present', async () => {
    const handler = vi.fn(async () => new Response('fresh', { status: 200 }));
    const response = await withIdempotency(new Request('https://shareout.site/v1/publish'), kvEnv(), handler);

    expect(handler).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe('fresh');
  });

  it('replays cached successful responses', async () => {
    const cached = { status: 201, body: '{"replayed":true}', headers: {} };
    const env = kvEnv(new Map([['idem:dup', JSON.stringify(cached)]]));
    const handler = vi.fn(async () => new Response('should-not-run'));

    const response = await withIdempotency(
      new Request('https://shareout.site/v1/publish', { headers: { 'X-Idempotency-Key': 'dup' } }),
      env,
      handler
    );

    expect(handler).not.toHaveBeenCalled();
    expect(response.headers.get('X-Idempotent-Replayed')).toBe('true');
    await expect(response.json()).resolves.toEqual({ replayed: true });
  });

  it('does not cache non-2xx responses', async () => {
    const store = new Map<string, string>();
    const env = kvEnv(store);
    const handler = vi.fn(async () => new Response('bad', { status: 400 }));

    await withIdempotency(
      new Request('https://shareout.site/v1/publish', { headers: { 'X-Idempotency-Key': 'fail' } }),
      env,
      handler
    );

    expect(store.has('idem:fail')).toBe(false);
  });

  it('caches successful 2xx responses for replay', async () => {
    const store = new Map<string, string>();
    const env = kvEnv(store);
    const handler = vi.fn(async () => new Response('{"id":"art_1"}', {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    }));

    const response = await withIdempotency(
      new Request('https://shareout.site/v1/publish', { headers: { 'X-Idempotency-Key': 'new-key' } }),
      env,
      handler
    );

    expect(handler).toHaveBeenCalledOnce();
    expect(response.status).toBe(201);
    expect(store.has('idem:new-key')).toBe(true);
  });
});
