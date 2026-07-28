import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleProxy, handleProxyConfig } from '../../src/proxy';
import * as middleware from '../../src/data/middleware';
import { createAccessToken } from '../../src/token';
import type { DataContext } from '../../src/data/middleware';
import type { Env } from '../../src/types';

const ARTIFACT_ID = 'art_proxy_test';

interface ProxyConfigRow {
  enabled: number;
  allowed_hosts: string | null;
  blocked_hosts: string | null;
  cache_ttl: number;
  max_requests_per_minute: number;
}

function createKvStore() {
  const store = new Map<string, string | ArrayBuffer>();

  return {
    store,
    kv: {
      get: async (key: string, type?: string) => {
        const value = store.get(key);
        if (value === undefined) return null;
        if (type === 'arrayBuffer') {
          if (value instanceof ArrayBuffer) return value;
          return new TextEncoder().encode(String(value)).buffer;
        }
        if (type === 'json') {
          return JSON.parse(String(value));
        }
        return value;
      },
      put: async (key: string, value: string | ArrayBuffer) => {
        store.set(key, value);
      },
    } as KVNamespace,
  };
}

function createProxyEnv(options: {
  proxyConfig?: ProxyConfigRow | null;
  ownerId?: string | null;
} = {}) {
  let proxyConfig = options.proxyConfig ?? null;
  const { kv, store } = createKvStore();
  const bindCalls: unknown[][] = [];

  const env = {
    SESSION_SECRET: 'session-secret',
    PROXY_CACHE: kv,
    DB: {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn((...args: unknown[]) => {
          bindCalls.push(args);
          return {
            first: vi.fn(async () => {
              if (sql.includes('artifact_proxy_config')) {
                return proxyConfig;
              }
              if (sql.includes('owner_id')) {
                return { owner_id: options.ownerId ?? 'usr_1' };
              }
              return null;
            }),
            run: vi.fn(async () => {
              if (sql.includes('artifact_proxy_config')) {
                proxyConfig = {
                  enabled: 0,
                  allowed_hosts: JSON.stringify(['cdn.example.com']),
                  blocked_hosts: null,
                  cache_ttl: 3600,
                  max_requests_per_minute: 1,
                };
              }
              return { success: true };
            }),
          };
        }),
      })),
    },
  } as unknown as Env;

  return {
    env,
    kvStore: store,
    bindCalls,
    setProxyConfig: (row: ProxyConfigRow | null) => { proxyConfig = row; },
  };
}

function createCtx(env: Env, origin = 'https://app.example.com'): DataContext {
  return {
    artifactId: ARTIFACT_ID,
    artifact: {
      id: ARTIFACT_ID,
      name: 'Proxy Test',
      visibility: 'public',
      auth_method: null,
      owner_id: 'usr_1',
    },
    env,
    origin,
  };
}

function proxyRequest(url: string, init: RequestInit = {}) {
  return new Request(
    `https://shareout.site/v1/data/${ARTIFACT_ID}/proxy?url=${encodeURIComponent(url)}`,
    { method: 'GET', ...init }
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('handleProxy', () => {
  it('rejects non-GET methods', async () => {
    const { env } = createProxyEnv();
    const response = await handleProxy(
      proxyRequest('https://api.example.com/data', { method: 'POST' }),
      createCtx(env),
      'proxy'
    );

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toMatchObject({ code: 'METHOD_NOT_ALLOWED' });
  });

  it('requires a url query parameter', async () => {
    const { env } = createProxyEnv();
    const response = await handleProxy(
      new Request(`https://shareout.site/v1/data/${ARTIFACT_ID}/proxy`),
      createCtx(env),
      'proxy'
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'INVALID_REQUEST',
      error: 'Missing url parameter',
    });
  });

  it('blocks invalid, private, and unsafe destinations', async () => {
    const { env } = createProxyEnv();
    const ctx = createCtx(env);

    const cases = [
      ['not-a-url', 'Invalid URL format'],
      ['file:///etc/passwd', 'Blocked protocol: file:'],
      ['javascript:alert(1)', 'Blocked protocol: javascript:'],
      ['ftp://files.example.com/x', 'Blocked protocol: ftp:'],
      ['http://127.0.0.1/admin', 'Blocked host: 127.0.0.1'],
      ['http://localhost/admin', 'Blocked host: localhost'],
      ['http://192.168.1.1/admin', 'Blocked private/internal IP: 192.168.1.1'],
      ['http://10.0.0.1/admin', 'Blocked private/internal IP: 10.0.0.1'],
      // SSRF encoding bypasses that reach loopback/metadata (previously allowed):
      ['http://2130706433/admin', 'Blocked host: 127.0.0.1'],
      ['http://[::1]/admin', 'Blocked host: ::1'],
      ['http://[::]/admin', 'Blocked internal IPv6: ::'],
      ['http://[::ffff:127.0.0.1]/admin', 'Blocked host: 127.0.0.1'],
      ['http://[::ffff:169.254.169.254]/', 'Blocked host: 169.254.169.254'],
    ] as const;

    for (const [url, error] of cases) {
      const response = await handleProxy(proxyRequest(url), ctx, 'proxy');
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        code: 'BLOCKED_DESTINATION',
        error,
      });
    }
  });

  it('rejects requests when proxy is disabled for the artifact', async () => {
    const { env } = createProxyEnv({
      proxyConfig: {
        enabled: 0,
        allowed_hosts: null,
        blocked_hosts: null,
        cache_ttl: 300,
        max_requests_per_minute: 100,
      },
    });

    const response = await handleProxy(
      proxyRequest('https://api.example.com/data'),
      createCtx(env),
      'proxy'
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'FORBIDDEN',
      error: 'Proxy disabled for this artifact',
    });
  });

  it('enforces allowed and blocked host lists', async () => {
    const allowedOnly = createProxyEnv({
      proxyConfig: {
        enabled: 1,
        allowed_hosts: JSON.stringify(['api.example.com']),
        blocked_hosts: null,
        cache_ttl: 300,
        max_requests_per_minute: 100,
      },
    });

    const blockedHost = await handleProxy(
      proxyRequest('https://evil.example.com/data'),
      createCtx(allowedOnly.env),
      'proxy'
    );
    expect(blockedHost.status).toBe(403);
    await expect(blockedHost.json()).resolves.toMatchObject({ code: 'HOST_NOT_ALLOWED' });

    const blockedList = createProxyEnv({
      proxyConfig: {
        enabled: 1,
        allowed_hosts: null,
        blocked_hosts: JSON.stringify(['blocked.example.com']),
        cache_ttl: 300,
        max_requests_per_minute: 100,
      },
    });

    const blocked = await handleProxy(
      proxyRequest('https://sub.blocked.example.com/data'),
      createCtx(blockedList.env),
      'proxy'
    );
    expect(blocked.status).toBe(403);
    await expect(blocked.json()).resolves.toMatchObject({
      code: 'HOST_NOT_ALLOWED',
      error: 'Host sub.blocked.example.com not allowed',
    });
  });

  it('returns 429 when artifact rate limit is exceeded', async () => {
    const { env } = createProxyEnv({
      proxyConfig: {
        enabled: 1,
        allowed_hosts: null,
        blocked_hosts: null,
        cache_ttl: 300,
        max_requests_per_minute: 1,
      },
    });

    const first = await handleProxy(
      proxyRequest('https://api.example.com/rate-limit'),
      createCtx(env),
      'proxy'
    );
    expect(first.status).not.toBe(429);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'));

    const second = await handleProxy(
      proxyRequest('https://api.example.com/rate-limit-2'),
      createCtx(env),
      'proxy'
    );

    expect(second.status).toBe(429);
    await expect(second.json()).resolves.toMatchObject({ code: 'PROXY_RATE_LIMITED' });
    expect(second.headers.get('X-RateLimit-Remaining')).toBe('0');
    expect(second.headers.get('Retry-After')).toBe('60');
  });

  it('serves cached responses with HIT header', async () => {
    const { env, kvStore } = createProxyEnv();
    const targetUrl = 'https://api.example.com/cached';
    const cacheKey = `proxy:cache:${ARTIFACT_ID}:${targetUrl}`;
    kvStore.set(cacheKey, new TextEncoder().encode('cached-body').buffer);
    kvStore.set(`${cacheKey}:meta`, JSON.stringify({ contentType: 'text/plain', status: 201 }));

    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const response = await handleProxy(proxyRequest(targetUrl), createCtx(env), 'proxy');

    expect(response.status).toBe(201);
    expect(await response.text()).toBe('cached-body');
    expect(response.headers.get('Content-Type')).toBe('text/plain');
    expect(response.headers.get('X-Proxy-Cache')).toBe('HIT');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('proxies upstream responses, strips sensitive headers, and caches successful misses', async () => {
    const { env, kvStore } = createProxyEnv();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('fresh-body', {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
        'Set-Cookie': 'session=abc',
        'X-Upstream': 'yes',
      },
    }));

    const targetUrl = 'https://api.example.com/fresh';
    const response = await handleProxy(proxyRequest(targetUrl), createCtx(env), 'proxy');

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('fresh-body');
    expect(response.headers.get('Content-Type')).toBe('text/html');
    expect(response.headers.get('X-Upstream')).toBe('yes');
    expect(response.headers.get('Set-Cookie')).toBeNull();
    expect(response.headers.get('X-Proxy-Cache')).toBe('MISS');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');

    const cacheKey = `proxy:cache:${ARTIFACT_ID}:${targetUrl}`;
    expect(kvStore.has(cacheKey)).toBe(true);
    expect(kvStore.has(`${cacheKey}:meta`)).toBe(true);
  });

  it('allows requests when artifact proxy cache KV is unavailable', async () => {
    const { env } = createProxyEnv();
    const ctx = createCtx({ ...env, PROXY_CACHE: undefined } as Env);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('no-kv', { status: 200 }));

    const response = await handleProxy(
      proxyRequest('https://api.example.com/no-kv'),
      ctx,
      'proxy'
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('no-kv');
    expect(response.headers.get('X-Proxy-Cache')).toBe('MISS');
  });

  it('does not cache non-OK upstream responses', async () => {
    const { env, kvStore } = createProxyEnv();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('missing', { status: 404 }));

    const targetUrl = 'https://api.example.com/missing';
    const response = await handleProxy(proxyRequest(targetUrl), createCtx(env), 'proxy');

    expect(response.status).toBe(404);
    expect(kvStore.has(`proxy:cache:${ARTIFACT_ID}:${targetUrl}`)).toBe(false);
  });

  it('rejects oversized responses by Content-Length and body size', async () => {
    const { env } = createProxyEnv();
    const ctx = createCtx(env);

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, {
        status: 200,
        headers: { 'Content-Length': String(11 * 1024 * 1024) },
      }))
      .mockResolvedValueOnce(new Response(new Uint8Array(11 * 1024 * 1024)));

    const tooLargeHeader = await handleProxy(
      proxyRequest('https://api.example.com/large-header'),
      ctx,
      'proxy'
    );
    expect(tooLargeHeader.status).toBe(413);
    await expect(tooLargeHeader.json()).resolves.toMatchObject({ code: 'FILE_TOO_LARGE' });

    const tooLargeBody = await handleProxy(
      proxyRequest('https://api.example.com/large-body'),
      ctx,
      'proxy'
    );
    expect(tooLargeBody.status).toBe(413);
    await expect(tooLargeBody.json()).resolves.toMatchObject({ code: 'FILE_TOO_LARGE' });
  });

  it('maps upstream timeouts and fetch failures to proxy errors', async () => {
    const { env } = createProxyEnv();
    const ctx = createCtx(env);

    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const error = new Error('Aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }));

    const timeoutPending = handleProxy(proxyRequest('https://slow.example.com'), ctx, 'proxy');
    await vi.advanceTimersByTimeAsync(10_000);
    const timeoutResponse = await timeoutPending;
    expect(timeoutResponse.status).toBe(502);
    await expect(timeoutResponse.json()).resolves.toMatchObject({
      code: 'PROXY_ERROR',
      error: 'Request timed out',
    });

    vi.useRealTimers();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network down'));
    const failure = await handleProxy(proxyRequest('https://down.example.com'), ctx, 'proxy');
    expect(failure.status).toBe(502);
    const failureBody = await failure.json();
    expect(failureBody).toMatchObject({
      code: 'PROXY_ERROR',
      error: 'Proxy request failed',
    });
    expect(JSON.stringify(failureBody)).not.toContain('network down');

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('D1_ERROR: no such table'));
    const internal = await handleProxy(proxyRequest('https://leak.example.com'), ctx, 'proxy');
    expect(internal.status).toBe(502);
    const internalBody = await internal.json();
    expect(internalBody).toMatchObject({
      code: 'PROXY_ERROR',
      error: 'Proxy request failed',
    });
    expect(JSON.stringify(internalBody)).not.toContain('D1_ERROR');
  });
});

describe('handleProxyConfig', () => {
  it('returns default config on GET when no row exists', async () => {
    const { env } = createProxyEnv({ proxyConfig: null });
    const response = await handleProxyConfig(
      new Request(`https://shareout.site/v1/data/${ARTIFACT_ID}/proxy/config`, { method: 'GET' }),
      createCtx(env)
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        enabled: true,
        allowed_hosts: null,
        blocked_hosts: null,
        cache_ttl: 300,
        max_requests_per_minute: 100,
      },
    });
  });

  it('returns stored config on GET', async () => {
    const { env } = createProxyEnv({
      proxyConfig: {
        enabled: 0,
        allowed_hosts: JSON.stringify(['api.example.com']),
        blocked_hosts: JSON.stringify(['evil.example.com']),
        cache_ttl: 120,
        max_requests_per_minute: 50,
      },
    });

    const response = await handleProxyConfig(
      new Request(`https://shareout.site/v1/data/${ARTIFACT_ID}/proxy/config`, { method: 'GET' }),
      createCtx(env)
    );

    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        enabled: false,
        allowed_hosts: ['api.example.com'],
        blocked_hosts: ['evil.example.com'],
        cache_ttl: 120,
        max_requests_per_minute: 50,
      },
    });
  });

  it('rejects config updates from non-owners', async () => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(false);
    const { env } = createProxyEnv();

    const response = await handleProxyConfig(
      new Request(`https://shareout.site/v1/data/${ARTIFACT_ID}/proxy/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      }),
      createCtx(env)
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: 'FORBIDDEN',
      error: 'Only artifact owner can modify proxy config',
    });
  });

  it('validates update payloads and persists owner changes', async () => {
    const { env, bindCalls } = createProxyEnv();
    const ctx = createCtx(env);
    const token = await createAccessToken(ARTIFACT_ID, 'owner', env);

    const invalidJson = await handleProxyConfig(
      new Request(`https://shareout.site/v1/data/${ARTIFACT_ID}/proxy/config`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}` },
        body: 'not-json',
      }),
      ctx
    );
    expect(invalidJson.status).toBe(400);
    await expect(invalidJson.json()).resolves.toMatchObject({ code: 'INVALID_JSON' });

    const noFields = await handleProxyConfig(
      new Request(`https://shareout.site/v1/data/${ARTIFACT_ID}/proxy/config`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ unknown: true }),
      }),
      ctx
    );
    expect(noFields.status).toBe(400);
    await expect(noFields.json()).resolves.toMatchObject({
      code: 'INVALID_REQUEST',
      error: 'No valid fields to update',
    });

    const updated = await handleProxyConfig(
      new Request(`https://shareout.site/v1/data/${ARTIFACT_ID}/proxy/config`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          enabled: false,
          allowed_hosts: ['cdn.example.com'],
          cache_ttl: 9999,
          max_requests_per_minute: 0,
        }),
      }),
      ctx
    );

    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      success: true,
      data: {
        enabled: false,
        allowed_hosts: ['cdn.example.com'],
        cache_ttl: 3600,
        max_requests_per_minute: 1,
      },
    });
    expect(bindCalls.some((args) => args.includes(0))).toBe(true);
    expect(bindCalls.some((args) => args.includes(JSON.stringify(['cdn.example.com'])))).toBe(true);
    expect(bindCalls.some((args) => args.includes(3600))).toBe(true);
    expect(bindCalls.some((args) => args.includes(1))).toBe(true);

    const blockedHostsUpdate = await handleProxyConfig(
      new Request(`https://shareout.site/v1/data/${ARTIFACT_ID}/proxy/config`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ blocked_hosts: ['evil.example.com'] }),
      }),
      ctx
    );
    expect(blockedHostsUpdate.status).toBe(200);
    expect(bindCalls.some((args) => args.includes(JSON.stringify(['evil.example.com'])))).toBe(true);
  });

  it('rejects unsupported methods', async () => {
    const { env } = createProxyEnv();
    const response = await handleProxyConfig(
      new Request(`https://shareout.site/v1/data/${ARTIFACT_ID}/proxy/config`, { method: 'DELETE' }),
      createCtx(env)
    );

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toMatchObject({ code: 'METHOD_NOT_ALLOWED' });
  });
});
