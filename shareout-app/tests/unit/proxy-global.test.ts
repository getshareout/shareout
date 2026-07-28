import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleGlobalProxy } from '../../src/proxy';
import type { Env } from '../../src/types';

function createGlobalEnv() {
  const store = new Map<string, string | ArrayBuffer>();

  return {
    store,
    env: {
      PROXY_CACHE: {
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
      },
    } as Env,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('handleGlobalProxy', () => {
  it('handles CORS preflight', async () => {
    const { env } = createGlobalEnv();
    const response = await handleGlobalProxy(new Request('https://shareout.site/proxy?url=https://api.example.com', {
      method: 'OPTIONS',
    }), env);

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  });

  it('rejects non-GET methods', async () => {
    const { env } = createGlobalEnv();
    const response = await handleGlobalProxy(new Request('https://shareout.site/proxy?url=https://api.example.com', {
      method: 'POST',
    }), env);

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toMatchObject({ code: 'METHOD_NOT_ALLOWED' });
  });

  it('requires a url query parameter', async () => {
    const { env } = createGlobalEnv();
    const response = await handleGlobalProxy(new Request('https://shareout.site/proxy'), env);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'INVALID_REQUEST',
      error: 'Missing url parameter',
    });
  });

  it('blocks private and unsafe destinations', async () => {
    const { env } = createGlobalEnv();
    const cases = [
      'http://127.0.0.1/admin',
      'http://localhost/admin',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'ftp://files.example.com/x',
      'not-a-url',
    ];

    for (const target of cases) {
      const blocked = await handleGlobalProxy(new Request(
        'https://shareout.site/proxy?url=' + encodeURIComponent(target)
      ), env);

      expect(blocked.status).toBe(403);
      await expect(blocked.json()).resolves.toMatchObject({ code: 'BLOCKED_DESTINATION' });
    }
  });

  it('returns 429 when global rate limit is exceeded', async () => {
    const { env, store } = createGlobalEnv();
    const ip = '203.0.113.10';
    const windowStart = Math.floor(Date.now() / 60000) * 60000;
    store.set(`proxy:global:${ip}:${windowStart}`, '100');

    const response = await handleGlobalProxy(new Request(
      'https://shareout.site/proxy?url=' + encodeURIComponent('https://api.example.com/rate-limited'),
      { headers: { 'cf-connecting-ip': ip } },
    ), env);

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({ code: 'RATE_LIMITED' });
    expect(response.headers.get('Retry-After')).toBe('60');
  });

  it('serves cached global responses with HIT header', async () => {
    const { env, store } = createGlobalEnv();
    const targetUrl = 'https://api.example.com/global-cache';
    const cacheKey = `proxy:global:cache:${targetUrl}`;
    store.set(cacheKey, new TextEncoder().encode('cached-global').buffer);
    store.set(`${cacheKey}:meta`, JSON.stringify({ contentType: 'text/plain', status: 202 }));

    const fetchMock = vi.spyOn(globalThis, 'fetch');
    const response = await handleGlobalProxy(new Request(
      'https://shareout.site/proxy?url=' + encodeURIComponent(targetUrl)
    ), env);

    expect(response.status).toBe(202);
    expect(await response.text()).toBe('cached-global');
    expect(response.headers.get('X-Proxy-Cache')).toBe('HIT');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('proxies upstream responses and strips sensitive headers', async () => {
    const { env, store } = createGlobalEnv();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('global-body', {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': 'session=abc',
        'WWW-Authenticate': 'Bearer',
      },
    }));

    const targetUrl = 'https://api.example.com/global-fresh';
    const response = await handleGlobalProxy(new Request(
      'https://shareout.site/proxy?url=' + encodeURIComponent(targetUrl)
    ), env);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('global-body');
    expect(response.headers.get('Set-Cookie')).toBeNull();
    expect(response.headers.get('WWW-Authenticate')).toBeNull();
    expect(response.headers.get('X-Proxy-Cache')).toBe('MISS');
    expect(store.has(`proxy:global:cache:${targetUrl}`)).toBe(true);
  });

  it('rejects oversized responses and upstream failures', async () => {
    const { env } = createGlobalEnv();

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, {
      status: 200,
      headers: { 'Content-Length': String(11 * 1024 * 1024) },
    }));
    const tooLarge = await handleGlobalProxy(new Request(
      'https://shareout.site/proxy?url=' + encodeURIComponent('https://api.example.com/large-header')
    ), env);
    expect(tooLarge.status).toBe(413);
    await expect(tooLarge.json()).resolves.toMatchObject({ code: 'FILE_TOO_LARGE' });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(new Uint8Array(11 * 1024 * 1024)));
    const tooLargeBody = await handleGlobalProxy(new Request(
      'https://shareout.site/proxy?url=' + encodeURIComponent('https://api.example.com/large-body')
    ), env);
    expect(tooLargeBody.status).toBe(413);
    await expect(tooLargeBody.json()).resolves.toMatchObject({ code: 'FILE_TOO_LARGE' });

    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const error = new Error('Aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }));

    const timeoutPending = handleGlobalProxy(new Request(
      'https://shareout.site/proxy?url=' + encodeURIComponent('https://slow.example.com')
    ), env);
    await vi.advanceTimersByTimeAsync(10_000);
    const timeout = await timeoutPending;
    expect(timeout.status).toBe(504);
    await expect(timeout.json()).resolves.toMatchObject({ code: 'PROXY_ERROR', error: 'Request timed out' });

    vi.useRealTimers();
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network down'));
    const failure = await handleGlobalProxy(new Request(
      'https://shareout.site/proxy?url=' + encodeURIComponent('https://down.example.com')
    ), env);
    expect(failure.status).toBe(502);
    const failureBody = await failure.json();
    expect(failureBody).toMatchObject({
      code: 'PROXY_ERROR',
      error: 'Proxy request failed',
    });
    expect(JSON.stringify(failureBody)).not.toContain('network down');

    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('D1_ERROR: no such table'));
    const internal = await handleGlobalProxy(new Request(
      'https://shareout.site/proxy?url=' + encodeURIComponent('https://leak.example.com')
    ), env);
    expect(internal.status).toBe(502);
    const internalBody = await internal.json();
    expect(internalBody).toMatchObject({
      code: 'PROXY_ERROR',
      error: 'Proxy request failed',
    });
    expect(JSON.stringify(internalBody)).not.toContain('D1_ERROR');
  });
});
