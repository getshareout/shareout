import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getShareOut,
  init,
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

describe('ShareOut initialization', () => {
  it('requires an artifact id outside the browser', () => {
    expect(() => new ShareOut({ baseUrl: 'https://api.example.com' })).toThrow(ShareOutError);
  });

  it('stores explicit artifact and base URL options', () => {
    const sdk = new ShareOut({
      artifactId: 'art_1',
      baseUrl: 'https://api.example.com',
    });

    expect(sdk._artifactId).toBe('art_1');
    expect(sdk._baseUrl).toBe('https://api.example.com');
  });

  it('initializes and returns the default instance', () => {
    const sdk = init({
      artifactId: 'art_default',
      baseUrl: 'https://api.example.com',
    });

    expect(getShareOut()).toBe(sdk);
  });
});

describe('_directFetch', () => {
  it('sends JSON requests with credentials and bearer auth', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      success: true,
      data: { ok: true },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const sdk = new ShareOut({
      artifactId: 'art_1',
      baseUrl: 'https://api.example.com',
      sessionToken: 'token_123',
    });

    await expect(sdk._directFetch('/json/settings', {
      method: 'PUT',
      body: JSON.stringify({ theme: 'dark' }),
    })).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Headers;
    expect(url).toBe('https://api.example.com/v1/data/art_1/json/settings');
    expect(init.method).toBe('PUT');
    expect(init.credentials).toBe('include');
    expect(headers.get('Content-Type')).toBe('application/json');
    expect(headers.get('Authorization')).toBe('Bearer token_123');
  });

  it('throws ShareOutError for unsuccessful API responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      success: false,
      error: 'Forbidden',
      code: 'FORBIDDEN',
    }, 403)));

    const sdk = new ShareOut({
      artifactId: 'art_1',
      baseUrl: 'https://api.example.com',
    });

    await expect(sdk._directFetch('/json/private')).rejects.toMatchObject({
      name: 'ShareOutError',
      message: 'Forbidden',
      code: 'FORBIDDEN',
      status: 403,
    });
  });

  it('throws ShareOutError when the server returns non-JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>502 Bad Gateway</html>', {
      status: 502,
      headers: { 'Content-Type': 'text/html' },
    })));

    const sdk = new ShareOut({
      artifactId: 'art_1',
      baseUrl: 'https://api.example.com',
    });

    await expect(sdk._directFetch('/json/settings')).rejects.toMatchObject({
      name: 'ShareOutError',
      code: 'INTERNAL_ERROR',
      status: 502,
    });
  });

  it('throws ShareOutError on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));

    const sdk = new ShareOut({
      artifactId: 'art_1',
      baseUrl: 'https://api.example.com',
    });

    await expect(sdk._directFetch('/json/settings')).rejects.toMatchObject({
      name: 'ShareOutError',
      code: 'NETWORK_ERROR',
      status: 0,
    });
  });
});

describe('optimized fetch path', () => {
  it('deduplicates in-flight GET requests and caches the result', async () => {
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
    });

    const first = sdk._internalFetch('/json/settings');
    const second = sdk._internalFetch('/json/settings');
    await vi.advanceTimersByTimeAsync(10);

    await expect(Promise.all([first, second])).resolves.toEqual([
      { key: 'settings', value: { theme: 'dark' } },
      { key: 'settings', value: { theme: 'dark' } },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await expect(sdk._internalFetch('/json/settings')).resolves.toEqual({
      key: 'settings',
      value: { theme: 'dark' },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sdk.cacheStats.size).toBe(1);
  });

  it('does NOT dedupe identical concurrent writes (each must hit the network)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ success: true, data: { ok: true } }));
    vi.stubGlobal('fetch', fetchMock);

    const sdk = new ShareOut({
      artifactId: 'art_1',
      baseUrl: 'https://api.example.com',
    });

    const body = JSON.stringify({ value: 1 });
    await Promise.all([
      sdk._internalFetch('/json/counter', { method: 'POST', body }),
      sdk._internalFetch('/json/counter', { method: 'POST', body }),
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('batches different GET requests into a single batch call', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => jsonResponse({
      success: true,
      data: {
        results: [
          { path: '/json/one', success: true, data: { value: 1 } },
          { path: '/json/two', success: true, data: { value: 2 } },
        ],
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const sdk = new ShareOut({
      artifactId: 'art_1',
      baseUrl: 'https://api.example.com',
      batchDelay: 10,
    });

    const one = sdk._internalFetch('/json/one');
    const two = sdk._internalFetch('/json/two');
    await vi.advanceTimersByTimeAsync(10);

    await expect(Promise.all([one, two])).resolves.toEqual([
      { value: 1 },
      { value: 2 },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/data/art_1/batch');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      requests: [
        { path: '/json/one', method: 'GET' },
        { path: '/json/two', method: 'GET' },
      ],
    });
  });

  it('rejects individual requests when a batch result fails', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      success: true,
      data: {
        results: [
          { path: '/json/one', success: true, data: { value: 1 } },
          { path: '/json/two', success: false, error: 'Missing key', code: 'KEY_NOT_FOUND' },
        ],
      },
    })));

    const sdk = new ShareOut({
      artifactId: 'art_1',
      baseUrl: 'https://api.example.com',
      batchDelay: 10,
    });

    const one = sdk._internalFetch('/json/one');
    const two = sdk._internalFetch('/json/two');
    const twoError = two.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10);

    await expect(one).resolves.toEqual({ value: 1 });
    await expect(twoError).resolves.toMatchObject({
      code: 'KEY_NOT_FOUND',
      message: 'Missing key',
    });
  });
});

describe('JsonStore', () => {
  function createSdk(fetchMock: ReturnType<typeof vi.fn>) {
    vi.stubGlobal('fetch', fetchMock);
    return new ShareOut({
      artifactId: 'art_1',
      baseUrl: 'https://api.example.com',
      batchDelay: 10,
    });
  }

  it('returns null for missing keys', async () => {
    vi.useFakeTimers();
    const sdk = createSdk(vi.fn(async () => jsonResponse({
      success: false,
      error: 'Missing key',
      code: 'KEY_NOT_FOUND',
    }, 404)));

    const value = sdk.json.get('missing');
    await vi.advanceTimersByTimeAsync(10);

    await expect(value).resolves.toBeNull();
  });

  it('gets and sets JSON values', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        return jsonResponse({
          success: true,
          data: { key: 'settings', created: true, updatedAt: '2024-01-01T00:00:00Z' },
        });
      }
      return jsonResponse({
        success: true,
        data: { key: 'settings', value: { theme: 'dark' }, updatedAt: '2024-01-01T00:00:00Z' },
      });
    });
    const sdk = createSdk(fetchMock);

    const setPromise = sdk.json.set('settings', { theme: 'dark' });
    await vi.advanceTimersByTimeAsync(10);
    await expect(setPromise).resolves.toMatchObject({ key: 'settings', created: true });

    const getPromise = sdk.json.get<{ theme: string }>('settings');
    await vi.advanceTimersByTimeAsync(10);
    await expect(getPromise).resolves.toEqual({ theme: 'dark' });
  });

  it('lists keys and updates values with CAS', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        const headers = new Headers(init.headers);
        expect(headers.get('If-Match')).toBe('2024-01-01T00:00:00Z');
        return jsonResponse({
          success: true,
          data: { key: 'counter', created: false, updatedAt: '2024-01-01T00:00:01Z' },
        });
      }
      if (_url.endsWith('/json')) {
        return jsonResponse({ success: true, data: { keys: ['counter'], count: 1 } });
      }
      return jsonResponse({
        success: true,
        data: { key: 'counter', value: 1, updatedAt: '2024-01-01T00:00:00Z' },
      });
    });
    const sdk = createSdk(fetchMock);

    const listPromise = sdk.json.list();
    await vi.advanceTimersByTimeAsync(10);
    await expect(listPromise).resolves.toEqual(['counter']);

    const updatePromise = sdk.json.update<number>('counter', (prev) => (prev ?? 0) + 1);
    await vi.advanceTimersByTimeAsync(10);
    await expect(updatePromise).resolves.toBe(2);
  });

  it('retries update on VERSION_CONFLICT', async () => {
    // Real timers: CAS does multiple get/put round-trips.
    let puts = 0;
    let gets = 0;
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const method = (init?.method || 'GET').toUpperCase();
      if (method === 'PUT') {
        puts += 1;
        if (puts === 1) {
          return jsonResponse({ success: false, error: 'conflict', code: 'VERSION_CONFLICT' }, 409);
        }
        return jsonResponse({
          success: true,
          data: { key: 'counter', created: false, updatedAt: 't2' },
        });
      }
      gets += 1;
      return jsonResponse({
        success: true,
        data: {
          key: 'counter',
          value: gets === 1 ? 10 : 20,
          updatedAt: gets === 1 ? 't0' : 't1',
        },
      });
    });
    const sdk = createSdk(fetchMock);
    // First attempt: read 10, write fails; second: read 20, write 21 succeeds.
    await expect(sdk.json.update<number>('counter', (prev) => (prev ?? 0) + 1)).resolves.toBe(21);
    expect(puts).toBe(2);
    expect(gets).toBe(2);
  });

  it('deletes keys and returns false when missing', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        return jsonResponse({ success: false, error: 'Missing', code: 'KEY_NOT_FOUND' }, 404);
      }
      return jsonResponse({ success: true, data: {} });
    });
    const sdk = createSdk(fetchMock);

    const deletePromise = sdk.json.delete('missing');
    await vi.advanceTimersByTimeAsync(10);
    await expect(deletePromise).resolves.toBe(false);
  });

  it('deletes keys and returns true when present', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        return jsonResponse({ success: true, data: {} });
      }
      return jsonResponse({ success: true, data: {} });
    });
    const sdk = createSdk(fetchMock);

    const deletePromise = sdk.json.delete('settings');
    await vi.advanceTimersByTimeAsync(10);
    await expect(deletePromise).resolves.toBe(true);
  });

  it('checks existence via HEAD request', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'HEAD') {
        return new Response(null, { status: 200 });
      }
      return jsonResponse({ success: true, data: {} });
    }));

    const sdk = new ShareOut({
      artifactId: 'art_1',
      baseUrl: 'https://api.example.com',
    });

    await expect(sdk.json.exists('settings')).resolves.toBe(true);
  });
});

describe('Table queries', () => {
  it('executes filtered table queries via POST', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain('/tables/users/query');
      expect(init?.method).toBe('POST');
      const body = JSON.parse(init?.body as string);
      expect(body.filter).toEqual({ status: { $eq: 'active' } });
      expect(body.limit).toBe(10);
      expect(body.count).toBe(false);

      return jsonResponse({
        success: true,
        data: {
          rows: [{ id: '1', name: 'Ada', status: 'active' }],
          hasMore: false,
        },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const sdk = new ShareOut({
      artifactId: 'art_1',
      baseUrl: 'https://api.example.com',
      batchDelay: 10,
    });

    const queryPromise = sdk
      .table<{ id: string; name: string; status: string }>('users')
      .find({ status: { $eq: 'active' } })
      .limit(10)
      .exec();
    await vi.advanceTimersByTimeAsync(10);

    await expect(queryPromise).resolves.toEqual([
      { id: '1', name: 'Ada', status: 'active' },
    ]);
  });

  it('returns null when findById misses', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      success: false,
      error: 'Not found',
      code: 'ROW_NOT_FOUND',
    }, 404)));

    const sdk = new ShareOut({
      artifactId: 'art_1',
      baseUrl: 'https://api.example.com',
      batchDelay: 10,
    });

    const promise = sdk.table('users').findById('missing');
    await vi.advanceTimersByTimeAsync(10);

    await expect(promise).resolves.toBeNull();
  });
});

describe('cache utilities', () => {
  it('clears cache and deduplicator state', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      success: true,
      data: { key: 'settings', value: { theme: 'dark' } },
    })));

    const sdk = new ShareOut({
      artifactId: 'art_1',
      baseUrl: 'https://api.example.com',
      batchDelay: 10,
    });

    const fetchPromise = sdk._internalFetch('/json/settings');
    await vi.advanceTimersByTimeAsync(10);
    await fetchPromise;

    expect(sdk.cacheStats.size).toBe(1);
    sdk.clearCache();
    expect(sdk.cacheStats.size).toBe(0);
  });

  it('invalidates table cache by name', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      success: true,
      data: { rows: [], total: 0, hasMore: false },
    })));

    const sdk = new ShareOut({
      artifactId: 'art_1',
      baseUrl: 'https://api.example.com',
      batchDelay: 10,
    });

    const queryPromise = sdk.table('users').find().exec();
    await vi.advanceTimersByTimeAsync(10);
    await queryPromise;
    expect(sdk.cacheStats.size).toBe(1);

    sdk.invalidateTableCache('users');
    expect(sdk.cacheStats.size).toBe(0);
  });

  it('invalidates all table caches when no table name is provided', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      success: true,
      data: { rows: [{ id: '1' }], total: 1, hasMore: false },
    })));

    const sdk = new ShareOut({
      artifactId: 'art_1',
      baseUrl: 'https://api.example.com',
      batchDelay: 10,
    });

    const usersPromise = sdk.table('users').find().exec();
    const ordersPromise = sdk.table('orders').find().exec();
    await vi.advanceTimersByTimeAsync(10);
    await Promise.all([usersPromise, ordersPromise]);
    expect(sdk.cacheStats.size).toBe(2);

    sdk.invalidateTableCache();
    expect(sdk.cacheStats.size).toBe(0);
  });
});

describe('Table mutations', () => {
  function createSdk(fetchMock: ReturnType<typeof vi.fn>) {
    vi.stubGlobal('fetch', fetchMock);
    return new ShareOut({
      artifactId: 'art_1',
      baseUrl: 'https://api.example.com',
      batchDelay: 10,
    });
  }

  it('inserts, updates, deletes, and counts rows', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/users/count') && init?.method === 'POST') {
        return jsonResponse({ success: true, data: { count: 3 } });
      }
      if (init?.method === 'POST' && url.endsWith('/tables/users') && !url.includes('/query')) {
        return jsonResponse({ success: true, data: { inserted: [{ id: '1', name: 'Ada' }], count: 1 } });
      }
      if (init?.method === 'PATCH' && url.includes('/users/1')) {
        return jsonResponse({ success: true, data: { id: '1', name: 'Grace' } });
      }
      if (init?.method === 'PATCH') {
        return jsonResponse({ success: true, data: { updated: 2 } });
      }
      if (init?.method === 'DELETE' && url.includes('/users/1')) {
        return jsonResponse({ success: true, data: {} });
      }
      if (init?.method === 'DELETE') {
        return jsonResponse({ success: true, data: { deleted: 1 } });
      }
      return jsonResponse({ success: true, data: { rows: [{ id: '1', name: 'Ada' }], total: 1, hasMore: false } });
    });
    const sdk = createSdk(fetchMock);

    const insertPromise = sdk.table<{ id: string; name: string }>('users').insert({ name: 'Ada' });
    await vi.advanceTimersByTimeAsync(10);
    await expect(insertPromise).resolves.toEqual({ id: '1', name: 'Ada' });

    const updateByIdPromise = sdk.table('users').updateById('1', { name: 'Grace' });
    await vi.advanceTimersByTimeAsync(10);
    await expect(updateByIdPromise).resolves.toEqual({ id: '1', name: 'Grace' });

    const updatePromise = sdk.table('users').update({ name: { $eq: 'Ada' } }, { name: 'Grace' });
    await vi.advanceTimersByTimeAsync(10);
    await expect(updatePromise).resolves.toEqual({ updated: 2 });

    const deleteByIdPromise = sdk.table('users').deleteById('1');
    await vi.advanceTimersByTimeAsync(10);
    await expect(deleteByIdPromise).resolves.toBe(true);

    const deletePromise = sdk.table('users').delete({ name: { $eq: 'Ada' } });
    await vi.advanceTimersByTimeAsync(10);
    await expect(deletePromise).resolves.toEqual({ deleted: 1 });

    const countPromise = sdk.table('users').count({ status: { $eq: 'active' } });
    await vi.advanceTimersByTimeAsync(10);
    await expect(countPromise).resolves.toBe(3);
  });

  it('returns null or false for missing rows on update and delete', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => jsonResponse({
      success: false,
      error: 'Not found',
      code: 'ROW_NOT_FOUND',
    }, 404));
    const sdk = createSdk(fetchMock);

    const updatePromise = sdk.table('users').updateById('missing', { name: 'X' });
    const deletePromise = sdk.table('users').deleteById('missing');
    await vi.advanceTimersByTimeAsync(10);

    await expect(updatePromise).resolves.toBeNull();
    await expect(deletePromise).resolves.toBe(false);
  });
});

describe('Connection and secrets APIs', () => {
  it('runs connection queries and returns data via fetch()', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      expect(JSON.parse(init?.body as string)).toEqual({
        query: 'SELECT 1',
        options: { cache: true },
      });
      return jsonResponse({
        success: true,
        data: { data: [{ value: 1 }], cached: false, executionTimeMs: 12, rowCount: 1 },
      });
    }));

    const sdk = new ShareOut({
      artifactId: 'art_1',
      baseUrl: 'https://api.example.com',
      batchDelay: 10,
    });

    const queryPromise = sdk.connection('warehouse').query('SELECT 1', { cache: true });
    await vi.advanceTimersByTimeAsync(10);
    await expect(queryPromise).resolves.toEqual({
      data: [{ value: 1 }],
      cached: false,
      executionTimeMs: 12,
      rowCount: 1,
    });

    const fetchPromise = sdk.connection('warehouse').fetch('SELECT 1', { cache: true });
    await vi.advanceTimersByTimeAsync(10);
    await expect(fetchPromise).resolves.toEqual([{ value: 1 }]);
  });

  it('proxies secrets-backed HTTP requests', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain('/secrets/stripe/proxy');
      expect(JSON.parse(init?.body as string)).toEqual({
        method: 'GET',
        path: '/v1/charges',
        query: { limit: '10' },
      });
      return jsonResponse({
        success: true,
        data: { data: [{ id: 'ch_1' }], status: 200, executionTimeMs: 40 },
      });
    }));

    const sdk = new ShareOut({
      artifactId: 'art_1',
      baseUrl: 'https://api.example.com',
      batchDelay: 10,
    });

    const promise = sdk.secrets.proxy('stripe', {
      method: 'GET',
      path: '/v1/charges',
      query: { limit: '10' },
    });
    await vi.advanceTimersByTimeAsync(10);
    await expect(promise).resolves.toEqual({
      data: [{ id: 'ch_1' }],
      status: 200,
      executionTimeMs: 40,
    });
  });
});

describe('Email and dataset APIs', () => {
  it('reads email status and sends owner notifications', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/email/status')) {
        return jsonResponse({
          success: true,
          data: { enabled: true, ownerEmailConfigured: true, from: 'noreply@example.com' },
        });
      }
      expect(init?.method).toBe('POST');
      return jsonResponse({
        success: true,
        data: { sent: true, to: 'owner@example.com', messageId: 'msg_1' },
      });
    }));

    const sdk = new ShareOut({
      artifactId: 'art_1',
      baseUrl: 'https://api.example.com',
      batchDelay: 10,
    });

    const statusPromise = sdk.email.status();
    await vi.advanceTimersByTimeAsync(10);
    await expect(statusPromise).resolves.toEqual({
      enabled: true,
      ownerEmailConfigured: true,
      from: 'noreply@example.com',
    });

    const notifyPromise = sdk.email.notifyOwner({ subject: 'Hello', text: 'Need help' });
    await vi.advanceTimersByTimeAsync(10);
    await expect(notifyPromise).resolves.toEqual({
      sent: true,
      to: 'owner@example.com',
      messageId: 'msg_1',
    });
  });

  it('loads dataset metadata, pages, and lists datasets', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/datasets/sales')) {
        return jsonResponse({
          success: true,
          data: { name: 'sales', format: 'csv', sizeBytes: 100, version: 2, updatedAt: '2024-01-01T00:00:00Z' },
        });
      }
      if (url.includes('/datasets/sales/content?')) {
        return jsonResponse({
          success: true,
          data: { data: [{ region: 'US', total: 10 }], offset: 0, limit: 1, total: 1, hasMore: false },
        });
      }
      // get() now reads the whole extract direct-from-R2 (008 Stage B2): download-url
      // then a direct fetch of the returned URL (raw bytes, no envelope).
      if (url.endsWith('/datasets/sales/download-url')) {
        return jsonResponse({
          success: true,
          data: { url: 'https://r2.example/sales.json?sig', format: 'json', direct: true, expiresIn: 300 },
        });
      }
      if (url.startsWith('https://r2.example/sales.json')) {
        return new Response(JSON.stringify([{ region: 'US', total: 10 }]), { status: 200 });
      }
      return jsonResponse({
        success: true,
        data: {
          datasets: [{ name: 'sales', format: 'csv', sizeBytes: 100, version: 2, updatedAt: '2024-01-01T00:00:00Z' }],
          count: 1,
        },
      });
    }));

    const sdk = new ShareOut({
      artifactId: 'art_1',
      baseUrl: 'https://api.example.com',
      batchDelay: 10,
    });

    const metadataPromise = sdk.dataset('sales').metadata();
    await vi.advanceTimersByTimeAsync(10);
    await expect(metadataPromise).resolves.toMatchObject({ name: 'sales', format: 'csv' });

    const pagePromise = sdk.dataset('sales').page({ offset: 0, limit: 1 });
    await vi.advanceTimersByTimeAsync(10);
    await expect(pagePromise).resolves.toMatchObject({ total: 1, hasMore: false });

    const getPromise = sdk.dataset('sales').get<{ region: string; total: number }>();
    await vi.advanceTimersByTimeAsync(10);
    await expect(getPromise).resolves.toEqual([{ region: 'US', total: 10 }]);

    const listPromise = sdk.dataset('sales').list();
    await vi.advanceTimersByTimeAsync(10);
    await expect(listPromise).resolves.toEqual([
      { name: 'sales', format: 'csv', sizeBytes: 100, version: 2, updatedAt: '2024-01-01T00:00:00Z' },
    ]);
  });
});

describe('prefetch and ShareOut.ready', () => {
  it('prefetches paths without failing when one request errors', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/json/ok')) {
        return jsonResponse({ success: true, data: { key: 'ok', value: true } });
      }
      return jsonResponse({ success: false, error: 'Missing', code: 'KEY_NOT_FOUND' }, 404);
    }));

    const sdk = new ShareOut({
      artifactId: 'art_1',
      baseUrl: 'https://api.example.com',
      batchDelay: 10,
    });

    const prefetchPromise = sdk.prefetch(['/json/ok', '/json/missing']);
    await vi.advanceTimersByTimeAsync(10);
    await expect(prefetchPromise).resolves.toBeUndefined();
  });

  it('posts a content-ready message when running inside an iframe', () => {
    const postMessage = vi.fn();
    vi.stubGlobal('window', {
      parent: { postMessage },
    });

    ShareOut.ready();
    expect(postMessage).toHaveBeenCalledWith({ type: 'shareout:content-ready' }, '*');
  });

  it('does not post when not embedded in an iframe', () => {
    const postMessage = vi.fn();
    const windowObj = { parent: null as unknown, postMessage };
    windowObj.parent = windowObj;
    vi.stubGlobal('window', windowObj);

    ShareOut.ready();
    expect(postMessage).not.toHaveBeenCalled();
  });
});
