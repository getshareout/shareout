import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getShareOut,
  init,
  registerServiceWorker,
  ShareOut,
  ShareOutError,
} from '../src/index';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('JsonStore extended', () => {
  it('updates values with a transform and clears all keys', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE' && url.endsWith('/json')) {
        return jsonResponse({ success: true, data: {} });
      }
      if (init?.method === 'PUT') {
        return jsonResponse({
          success: true,
          data: { key: 'counter', created: false, updatedAt: '2024-01-01T00:00:01Z' },
        });
      }
      return jsonResponse({
        success: true,
        data: { key: 'counter', value: 2, updatedAt: '2024-01-01T00:00:00Z' },
      });
    }));

    const sdk = new ShareOut({
      artifactId: 'art_1',
      baseUrl: 'https://api.example.com',
      batchDelay: 10,
    });

    const updatePromise = sdk.json.update<number>('counter', (prev) => (prev ?? 0) + 3);
    await vi.advanceTimersByTimeAsync(10);
    await expect(updatePromise).resolves.toBe(5);

    const clearPromise = sdk.json.clear();
    await vi.advanceTimersByTimeAsync(10);
    await expect(clearPromise).resolves.toBeUndefined();
  });
});

describe('PlatformStore', () => {
  it('lists providers and connections, executes via provider()', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/platform/providers')) {
        return jsonResponse({
          success: true,
          data: { providers: [{ id: 'bigquery', name: 'BigQuery' }] },
        });
      }
      if (url.endsWith('/platform/connections')) {
        return jsonResponse({
          success: true,
          data: {
            connections: [{ id: 'conn_1', name: 'bigquery', provider: 'bigquery' }],
          },
        });
      }
      if (url.includes('/platform/bigquery/jobs.query/execute') && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        expect(body.connectionId).toBe('conn_1');
        return jsonResponse({
          success: true,
          data: { success: true, data: { rows: [{ f: [{ v: '1' }] }] } },
        });
      }
      return jsonResponse({ success: false, error: 'unexpected' }, 500);
    });
    vi.stubGlobal('fetch', fetchMock);

    const sdk = new ShareOut({
      artifactId: 'art_1',
      baseUrl: 'https://api.example.com',
      batchDelay: 10,
    });

    const providersP = sdk.platform.providers();
    await vi.advanceTimersByTimeAsync(10);
    await expect(providersP).resolves.toEqual([{ id: 'bigquery', name: 'BigQuery' }]);

    const connP = sdk.platform.connectionByName('bigquery');
    await vi.advanceTimersByTimeAsync(10);
    await expect(connP).resolves.toMatchObject({ id: 'conn_1', name: 'bigquery' });

    const execP = sdk.platform.execute('bigquery', 'jobs.query', {
      connectionId: 'conn_1',
      params: { pathParams: { projectId: 'p' }, body: { query: 'SELECT 1' } },
    });
    await vi.advanceTimersByTimeAsync(10);
    await expect(execP).resolves.toMatchObject({ success: true });
  });
});

describe('Table query builder', () => {
  it('supports sort, skip, select, findOne, insertMany, and distinct', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/users/distinct') && init?.method === 'POST') {
        return jsonResponse({ success: true, data: { values: ['active', 'pending'] } });
      }
      if (url.endsWith('/tables/users') && init?.method === 'POST') {
        return jsonResponse({
          success: true,
          data: {
            inserted: [
              { id: '1', name: 'Ada', status: 'active' },
              { id: '2', name: 'Grace', status: 'pending' },
            ],
            count: 2,
          },
        });
      }
      if (url.endsWith('/users/query') && init?.method === 'POST') {
        const body = JSON.parse(init.body as string);
        if (body.sort?.name === 'asc') {
          expect(body.skip).toBe(5);
          expect(body.limit).toBe(1);
          expect(body.select).toEqual(['name']);
        }
        return jsonResponse({
          success: true,
          data: { rows: [{ id: '1', name: 'Ada', status: 'active' }], total: 1, hasMore: false },
        });
      }
      return jsonResponse({ success: true, data: {} });
    }));

    const sdk = new ShareOut({
      artifactId: 'art_1',
      baseUrl: 'https://api.example.com',
      batchDelay: 10,
    });

    const insertManyPromise = sdk.table<{ id: string; name: string; status: string }>('users').insertMany([
      { name: 'Ada', status: 'active' },
      { name: 'Grace', status: 'pending' },
    ]);
    await vi.advanceTimersByTimeAsync(10);
    await expect(insertManyPromise).resolves.toHaveLength(2);

    const findOnePromise = sdk.table('users').findOne({ status: { $eq: 'active' } });
    await vi.advanceTimersByTimeAsync(10);
    await expect(findOnePromise).resolves.toEqual({ id: '1', name: 'Ada', status: 'active' });

    const queryPromise = sdk
      .table('users')
      .find()
      .sort('name', 'asc')
      .skip(5)
      .limit(1)
      .select(['name'])
      .exec();
    await vi.advanceTimersByTimeAsync(10);
    await expect(queryPromise).resolves.toEqual([{ id: '1', name: 'Ada', status: 'active' }]);

    const distinctPromise = sdk.table('users').distinct('status');
    await vi.advanceTimersByTimeAsync(10);
    await expect(distinctPromise).resolves.toEqual(['active', 'pending']);
  });
});

describe('Email sendReport', () => {
  it('sends report emails to recipients', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain('/email/send-report');
      expect(JSON.parse(init?.body as string)).toEqual({
        to: 'team@example.com',
        subject: 'Weekly summary',
      });
      return jsonResponse({
        success: true,
        data: { sent: true, to: 'team@example.com', messageId: 'msg_2' },
      });
    }));

    const sdk = new ShareOut({
      artifactId: 'art_1',
      baseUrl: 'https://api.example.com',
      batchDelay: 10,
    });

    const promise = sdk.email.sendReport({
      to: 'team@example.com',
      subject: 'Weekly summary',
    });
    await vi.advanceTimersByTimeAsync(10);
    await expect(promise).resolves.toEqual({
      sent: true,
      to: 'team@example.com',
      messageId: 'msg_2',
    });
  });
});

describe('Dataset stream', () => {
  it('returns the response body stream for dataset downloads', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('a,b\n1,2'));
        controller.close();
      },
    });

    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, { status: 200 })));

    const sdk = new ShareOut({
      artifactId: 'art_1',
      baseUrl: 'https://api.example.com',
    });

    const body = await sdk.dataset('sales').stream();
    const text = await new Response(body).text();
    expect(text).toBe('a,b\n1,2');
  });

  it('sends the viewer session Bearer on stream (sandbox-safe)', async () => {
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      return new Response(new ReadableStream({
        start(c) { c.enqueue(new TextEncoder().encode('x')); c.close(); },
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const sdk = new ShareOut({
      artifactId: 'art_1',
      baseUrl: 'https://api.example.com',
      sessionToken: 'sess_test_token',
    });

    await sdk.dataset('sales').stream();
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = new Headers(init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer sess_test_token');
    expect(init?.credentials).toBe('include');
  });

  it('throws ShareOutError when stream request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));

    const sdk = new ShareOut({
      artifactId: 'art_1',
      baseUrl: 'https://api.example.com',
    });

    await expect(sdk.dataset('sales').stream()).rejects.toMatchObject({
      code: 'STREAM_ERROR',
      status: 500,
    });
  });
});

describe('Dataset.get — whole extract direct-from-R2 (008 Stage B2)', () => {
  function sdk() {
    return new ShareOut({ artifactId: 'art_1', baseUrl: 'https://api.example.com' });
  }

  it('reads the whole extract directly from the presigned R2 URL (bytes bypass the Worker)', async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      if (url.endsWith('/datasets/sales/download-url')) {
        return jsonResponse({ success: true, data: { url: 'https://r2.example/sales.json?sig', format: 'json', direct: true } });
      }
      if (url.startsWith('https://r2.example/')) {
        return new Response(JSON.stringify([{ id: 1 }, { id: 2 }, { id: 3 }]), { status: 200 });
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal('fetch', fetchSpy);

    const rows = await sdk().dataset('sales').get<{ id: number }>();
    expect(rows).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    // The bytes were fetched from R2, not proxied through the Worker /content endpoint.
    expect(fetchSpy.mock.calls.some(([u]) => String(u).startsWith('https://r2.example/'))).toBe(true);
    expect(fetchSpy.mock.calls.some(([u]) => String(u).includes('/content'))).toBe(false);
  });

  it('parses a CSV extract client-side (quoted fields, trimmed values)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/datasets/sales/download-url')) {
        return jsonResponse({ success: true, data: { url: 'https://r2.example/sales.csv?sig', format: 'csv', direct: true } });
      }
      return new Response('name,note\nAlice,"hello, world"\nBob,"say ""hi"""\n', { status: 200 });
    }));

    const rows = await sdk().dataset('sales').get();
    expect(rows).toEqual([
      { name: 'Alice', note: 'hello, world' },
      { name: 'Bob', note: 'say "hi"' },
    ]);
  });

  it('falls back to the Worker stream when the direct R2 fetch is blocked', async () => {
    const urls: string[] = [];
    const authHeaders: (string | null)[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      urls.push(url);
      if (url.endsWith('/datasets/sales/download-url')) {
        return jsonResponse({ success: true, data: { url: 'https://r2.example/sales.json?sig', format: 'json', direct: true } });
      }
      if (url.startsWith('https://r2.example/')) {
        throw new TypeError('Failed to fetch'); // simulate an R2 CORS / network failure
      }
      // Worker stream fallback — must carry session Bearer in the sandbox.
      authHeaders.push(new Headers(init?.headers).get('Authorization'));
      return new Response(JSON.stringify([{ ok: true }]), { status: 200 });
    }));

    const client = new ShareOut({
      artifactId: 'art_1',
      baseUrl: 'https://api.example.com',
      sessionToken: 'sess_fallback',
    });
    const rows = await client.dataset('sales').get<{ ok: boolean }>();
    expect(rows).toEqual([{ ok: true }]);
    expect(urls.some((u) => u.includes('/datasets/sales/stream'))).toBe(true);
    expect(authHeaders.some((h) => h === 'Bearer sess_fallback')).toBe(true);
  });

  it('wraps a non-array JSON extract as a single row', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/download-url')) {
        return jsonResponse({ success: true, data: { url: 'https://r2.example/one.json?sig', format: 'json', direct: true } });
      }
      return new Response(JSON.stringify({ solo: true }), { status: 200 });
    }));

    expect(await sdk().dataset('sales').get()).toEqual([{ solo: true }]);
  });
});

describe('SWR cache revalidation', () => {
  it('returns stale cached GET data and revalidates in the background', async () => {
    vi.useFakeTimers();
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      callCount += 1;
      return jsonResponse({
        success: true,
        data: { key: 'settings', value: { theme: callCount === 1 ? 'dark' : 'light' } },
      });
    }));

    const sdk = new ShareOut({
      artifactId: 'art_1',
      baseUrl: 'https://api.example.com',
      batchDelay: 10,
      cacheTTL: 20,
    });

    const first = sdk._internalFetch('/json/settings');
    await vi.advanceTimersByTimeAsync(10);
    await expect(first).resolves.toEqual({ key: 'settings', value: { theme: 'dark' } });

    await vi.advanceTimersByTimeAsync(30);

    const second = sdk._internalFetch('/json/settings');
    await vi.advanceTimersByTimeAsync(10);
    await expect(second).resolves.toEqual({ key: 'settings', value: { theme: 'dark' } });

    await vi.advanceTimersByTimeAsync(20);
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it('skips caching when cache option is disabled', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => jsonResponse({
      success: true,
      data: { key: 'settings', value: { theme: 'dark' } },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const sdk = new ShareOut({
      artifactId: 'art_1',
      baseUrl: 'https://api.example.com',
      batchDelay: 10,
      cache: false,
    });

    const first = sdk._internalFetch('/json/settings');
    await vi.advanceTimersByTimeAsync(10);
    await first;

    const second = sdk._internalFetch('/json/settings');
    await vi.advanceTimersByTimeAsync(10);
    await second;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sdk.cacheStats.size).toBe(0);
  });
});

describe('init and service worker exports', () => {
  it('re-exports service worker helpers from the package entry', async () => {
    vi.stubGlobal('window', undefined);
    await expect(registerServiceWorker()).resolves.toBeNull();
  });

  it('creates a default ShareOut instance through getShareOut', () => {
    init({ artifactId: 'art_default', baseUrl: 'https://api.example.com' });
    expect(getShareOut()._artifactId).toBe('art_default');
  });
});

describe('mutation cache invalidation', () => {
  it('invalidates cached json values after PUT', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return jsonResponse({ success: true, data: { key: 'settings', value: { theme: 'light' } } });
      }
      return jsonResponse({
        success: true,
        data: { key: 'settings', value: { theme: 'dark' }, updatedAt: '2024-01-01T00:00:00Z' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const sdk = new ShareOut({
      artifactId: 'art_1',
      baseUrl: 'https://api.example.com',
      batchDelay: 10,
    });

    const getPromise = sdk._internalFetch('/json/settings');
    await vi.advanceTimersByTimeAsync(10);
    await getPromise;
    expect(sdk.cacheStats.size).toBe(1);

    const setPromise = sdk.json.set('settings', { theme: 'light' });
    await vi.advanceTimersByTimeAsync(10);
    await setPromise;

    const refetchPromise = sdk._internalFetch('/json/settings');
    await vi.advanceTimersByTimeAsync(10);
    await refetchPromise;
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});
