import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlatformCache } from '../../../../src/data/platform/core/cache';
import type { CacheEntry } from '../../../../src/data/platform/types';
import type { Env } from '../../../../src/types';

const env = { DB: { prepare: vi.fn() }, ARTIFACTS: { get: vi.fn(), put: vi.fn(), delete: vi.fn() } } as unknown as Env;

function mockDb(
  handlers: {
    first?: (sql: string, bindings: unknown[]) => unknown;
    run?: (sql: string, bindings: unknown[]) => { meta: { changes: number } };
  } = {}
) {
  const prepare = vi.fn((sql: string) => ({
    bind: (...bindings: unknown[]) => ({
      first: vi.fn(async () => handlers.first?.(sql, bindings) ?? null),
      run: vi.fn(async () => handlers.run?.(sql, bindings) ?? { meta: { changes: 0 } }),
    }),
  }));
  return prepare;
}

function sampleEntry(overrides: Partial<CacheEntry<{ ok: boolean }>> = {}): CacheEntry<{ ok: boolean }> {
  return {
    data: { ok: true },
    createdAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    provider: 'google-sheets',
    endpoint: 'values.get',
    queryHash: 'sample-key',
    userRefreshable: true,
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('PlatformCache.generateCacheKey', () => {
  it('returns provider:endpoint:scope when params are absent', () => {
    expect(PlatformCache.generateCacheKey('google-sheets', 'values.get')).toBe('google-sheets:values.get:all');
  });

  it('includes a stable hash when params are provided', () => {
    const withParams = PlatformCache.generateCacheKey('google-sheets', 'values.get', { sheet: 'A1', range: 'B2' });
    const reordered = PlatformCache.generateCacheKey('google-sheets', 'values.get', { range: 'B2', sheet: 'A1' });

    expect(withParams).toMatch(/^google-sheets:values\.get:all:[a-z0-9]+$/);
    expect(withParams).toBe(reordered);
  });

  it('returns provider:endpoint:scope when params object is empty', () => {
    expect(PlatformCache.generateCacheKey('google-sheets', 'values.get', {})).toBe('google-sheets:values.get:all');
  });

  it('segments the key by viewer scope so filtered results never collide', () => {
    const acme = PlatformCache.generateCacheKey('snowflake', 'statements.execute', { body: { statement: 'X' } }, 'company_id:1,2');
    const globex = PlatformCache.generateCacheKey('snowflake', 'statements.execute', { body: { statement: 'X' } }, 'company_id:3');
    const owner = PlatformCache.generateCacheKey('snowflake', 'statements.execute', { body: { statement: 'X' } });
    expect(acme).not.toBe(globex);
    expect(acme).not.toBe(owner);
    expect(acme).toContain(':company_id:1,2:');
  });
});

describe('PlatformCache memory layer', () => {
  it('stores and retrieves entries before expiry', async () => {
    const cache = new PlatformCache(env, 'art_1', { maxMemoryEntries: 10 });

    await cache.set('query-1', { rows: [1, 2] }, {
      ttlMs: 60_000,
      provider: 'google-sheets',
      endpoint: 'values.get',
      persist: false,
      userRefreshable: true,
    });

    const entry = await cache.get<{ rows: number[] }>('query-1');
    expect(entry?.data).toEqual({ rows: [1, 2] });
    expect(entry?.provider).toBe('google-sheets');
  });

  it('expires stale memory entries', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const cache = new PlatformCache(env, 'art_1');

    await cache.set('query-2', { value: 1 }, {
      ttlMs: 1000,
      provider: 'shopify',
      endpoint: 'products.list',
      persist: false,
      userRefreshable: false,
    });

    vi.setSystemTime(new Date('2026-01-01T00:00:02Z'));
    await expect(cache.get('query-2')).resolves.toBeNull();
  });

  it('invalidates entries by provider, endpoint, or key', async () => {
    const cache = new PlatformCache(env, 'art_1');

    await cache.set('shopify:orders', { n: 1 }, {
      ttlMs: 60_000,
      provider: 'shopify',
      endpoint: 'orders.list',
      persist: false,
      userRefreshable: true,
    });
    await cache.set('shopify:products', { n: 2 }, {
      ttlMs: 60_000,
      provider: 'shopify',
      endpoint: 'products.list',
      persist: false,
      userRefreshable: false,
    });
    await cache.set('sheets:values', { n: 3 }, {
      ttlMs: 60_000,
      provider: 'google-sheets',
      endpoint: 'values.get',
      persist: false,
      userRefreshable: true,
    });

    expect(await cache.invalidate({ provider: 'shopify' })).toBe(2);
    expect(await cache.get('sheets:values')).not.toBeNull();
    expect(await cache.get('shopify:orders')).toBeNull();
  });

  it('invalidates entries by endpoint or key only', async () => {
    const cache = new PlatformCache(env, 'art_1');

    await cache.set('shopify:orders', { n: 1 }, {
      ttlMs: 60_000,
      provider: 'shopify',
      endpoint: 'orders.list',
      persist: false,
      userRefreshable: false,
    });
    await cache.set('shopify:products', { n: 2 }, {
      ttlMs: 60_000,
      provider: 'shopify',
      endpoint: 'products.list',
      persist: false,
      userRefreshable: false,
    });

    expect(await cache.invalidate({ provider: 'shopify', endpoint: 'orders.list' })).toBe(1);
    expect(await cache.get('shopify:orders')).toBeNull();
    expect(await cache.get('shopify:products')).not.toBeNull();

    await cache.set('target-key', { n: 3 }, {
      ttlMs: 60_000,
      provider: 'google-sheets',
      endpoint: 'values.get',
      persist: false,
      userRefreshable: false,
    });
    await cache.set('other-key', { n: 4 }, {
      ttlMs: 60_000,
      provider: 'google-sheets',
      endpoint: 'values.get',
      persist: false,
      userRefreshable: false,
    });

    expect(await cache.invalidate({ key: 'target-key' })).toBe(1);
    expect(await cache.get('target-key')).toBeNull();
    expect(await cache.get('other-key')).not.toBeNull();
  });

  it('supports user refresh for refreshable provider entries', async () => {
    const cache = new PlatformCache(env, 'art_1');

    await cache.set('refreshable', { ok: true }, {
      ttlMs: 60_000,
      provider: 'google-sheets',
      endpoint: 'values.get',
      persist: false,
      userRefreshable: true,
    });
    await cache.set('fixed', { ok: true }, {
      ttlMs: 60_000,
      provider: 'google-sheets',
      endpoint: 'metadata.get',
      persist: false,
      userRefreshable: false,
    });

    expect(await cache.userRefresh('google-sheets')).toBe(1);
    expect(await cache.get('refreshable')).toBeNull();
    expect(await cache.get('fixed')).not.toBeNull();
  });

  it('supports user refresh scoped to a single endpoint', async () => {
    const cache = new PlatformCache(env, 'art_1');

    await cache.set('values', { ok: true }, {
      ttlMs: 60_000,
      provider: 'google-sheets',
      endpoint: 'values.get',
      persist: false,
      userRefreshable: true,
    });
    await cache.set('metadata', { ok: true }, {
      ttlMs: 60_000,
      provider: 'google-sheets',
      endpoint: 'metadata.get',
      persist: false,
      userRefreshable: true,
    });

    expect(await cache.userRefresh('google-sheets', 'values.get')).toBe(1);
    expect(await cache.get('values')).toBeNull();
    expect(await cache.get('metadata')).not.toBeNull();
  });

  it('clears the in-memory cache', async () => {
    const cache = new PlatformCache(env, 'art_1');

    await cache.set('cached', { ok: true }, {
      ttlMs: 60_000,
      provider: 'google-sheets',
      endpoint: 'values.get',
      persist: false,
      userRefreshable: false,
    });

    cache.clearMemory();

    expect(await cache.getStatus()).toMatchObject({ memoryEntries: 0, providers: {} });
  });

  it('reports cache status and trims oldest entries when over capacity', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    const cache = new PlatformCache(env, 'art_1', { maxMemoryEntries: 2 });

    await cache.set('first', 1, {
      ttlMs: 60_000,
      provider: 'a',
      endpoint: 'one',
      persist: false,
      userRefreshable: false,
    });

    vi.setSystemTime(new Date('2026-01-01T00:00:01Z'));
    await cache.set('second', 2, {
      ttlMs: 60_000,
      provider: 'b',
      endpoint: 'two',
      persist: false,
      userRefreshable: false,
    });

    vi.setSystemTime(new Date('2026-01-01T00:00:02Z'));
    await cache.set('third', 3, {
      ttlMs: 60_000,
      provider: 'c',
      endpoint: 'three',
      persist: false,
      userRefreshable: false,
    });

    expect(await cache.get('first')).toBeNull();
    expect(await cache.get('second')).not.toBeNull();
    expect(await cache.get('third')).not.toBeNull();

    const status = await cache.getStatus();
    expect(status.memoryEntries).toBe(2);
    expect(status.providers).toMatchObject({
      b: { entries: 1 },
      c: { entries: 1 },
    });
  });

  it('counts multiple entries for the same provider in status', async () => {
    const cache = new PlatformCache(env, 'art_1');

    await cache.set('one', 1, {
      ttlMs: 60_000,
      provider: 'shopify',
      endpoint: 'orders.list',
      persist: false,
      userRefreshable: false,
    });
    await cache.set('two', 2, {
      ttlMs: 60_000,
      provider: 'shopify',
      endpoint: 'products.list',
      persist: false,
      userRefreshable: false,
    });

    const status = await cache.getStatus();
    expect(status.memoryEntries).toBe(2);
    expect(status.providers.shopify.entries).toBe(2);
  });
});

describe('PlatformCache persisted layer (artifact_json)', () => {
  let prepare: ReturnType<typeof mockDb>;

  beforeEach(() => {
    prepare = mockDb();
    env.DB.prepare = prepare;
    vi.mocked(env.ARTIFACTS.get).mockReset();
    vi.mocked(env.ARTIFACTS.put).mockReset();
    vi.mocked(env.ARTIFACTS.delete).mockReset();
  });

  it('hydrates memory from persisted artifact_json rows', async () => {
    const persisted = sampleEntry({ queryHash: 'persisted-key', data: { ok: false } });
    prepare = mockDb({
      first: (sql, bindings) => {
        if (sql.includes('SELECT value FROM artifact_json')) {
          expect(bindings).toEqual(['art_1', 'platform_cache:persisted-key']);
          return { value: JSON.stringify(persisted) };
        }
        return null;
      },
    });
    env.DB.prepare = prepare;

    const cache = new PlatformCache(env, 'art_1');
    const entry = await cache.get('persisted-key');

    expect(entry?.data).toEqual({ ok: false });
    expect(await cache.get('persisted-key')).toEqual(entry);
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it('ignores expired persisted rows', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));

    prepare = mockDb({
      first: () => ({
        value: JSON.stringify(sampleEntry({
          queryHash: 'expired-key',
          expiresAt: new Date('2026-01-01T00:00:00Z').getTime() - 1,
        })),
      }),
    });
    env.DB.prepare = prepare;

    const cache = new PlatformCache(env, 'art_1');
    await expect(cache.get('expired-key')).resolves.toBeNull();
  });

  it('writes persisted entries to artifact_json when enabled', async () => {
    const run = vi.fn().mockResolvedValue({ meta: { changes: 1 } });
    prepare = vi.fn(() => ({
      bind: (...bindings: unknown[]) => {
        expect(bindings[0]).toBe('art_1');
        expect(bindings[1]).toBe('platform_cache:write-key');
        expect(JSON.parse(String(bindings[2]))).toMatchObject({
          data: { saved: true },
          provider: 'shopify',
          endpoint: 'orders.list',
        });
        return { run };
      },
    }));
    env.DB.prepare = prepare;

    const cache = new PlatformCache(env, 'art_1');
    await cache.set('write-key', { saved: true }, {
      ttlMs: 60_000,
      provider: 'shopify',
      endpoint: 'orders.list',
      persist: true,
      userRefreshable: false,
    });

    expect(run).toHaveBeenCalledOnce();
  });

  it('invalidates persisted rows by key, provider, and provider+endpoint', async () => {
    prepare = mockDb({
      run: (sql, bindings) => {
        if (sql.includes('DELETE FROM artifact_json') && bindings[1] === 'platform_cache:delete-key') {
          return { meta: { changes: 1 } };
        }
        if (sql.includes('DELETE FROM artifact_json') && bindings[1] === 'platform_cache:shopify:orders.list%') {
          return { meta: { changes: 2 } };
        }
        if (sql.includes('DELETE FROM artifact_json') && bindings[1] === 'platform_cache:shopify:%') {
          return { meta: { changes: 3 } };
        }
        return { meta: { changes: 0 } };
      },
    });
    env.DB.prepare = prepare;

    const cache = new PlatformCache(env, 'art_1');

    expect(await cache.invalidate({ key: 'delete-key' })).toBe(1);
    expect(await cache.invalidate({ provider: 'shopify', endpoint: 'orders.list' })).toBe(2);
    expect(await cache.invalidate({ provider: 'shopify' })).toBe(3);
  });

  it('treats missing delete counts as zero for artifact_json invalidation', async () => {
    prepare = mockDb({
      run: () => ({ meta: {} }),
    });
    env.DB.prepare = prepare;

    const cache = new PlatformCache(env, 'art_1');

    expect(await cache.invalidate({ key: 'no-count' })).toBe(0);
    expect(await cache.invalidate({ provider: 'shopify', endpoint: 'orders.list' })).toBe(0);
    expect(await cache.invalidate({ provider: 'shopify' })).toBe(0);
  });

  it('returns null when artifact_json reads fail', async () => {
    prepare = vi.fn(() => {
      throw new Error('db unavailable');
    });
    env.DB.prepare = prepare;

    const cache = new PlatformCache(env, 'art_1');
    await expect(cache.get('broken-read')).resolves.toBeNull();
  });

  it('returns null when artifact_json row is missing', async () => {
    prepare = mockDb({ first: () => null });
    env.DB.prepare = prepare;

    const cache = new PlatformCache(env, 'art_1');
    await expect(cache.get('missing-key')).resolves.toBeNull();
  });

  it('swallows artifact_json write failures', async () => {
    prepare = vi.fn(() => {
      throw new Error('db unavailable');
    });
    env.DB.prepare = prepare;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const cache = new PlatformCache(env, 'art_1');
    await cache.set('write-fail', { ok: true }, {
      ttlMs: 60_000,
      provider: 'shopify',
      endpoint: 'orders.list',
      persist: true,
      userRefreshable: false,
    });

    expect(errorSpy).toHaveBeenCalledWith('Failed to write to persisted cache:', expect.any(Error));
    errorSpy.mockRestore();
  });

  it('returns zero when artifact_json invalidation fails', async () => {
    prepare = vi.fn(() => {
      throw new Error('db unavailable');
    });
    env.DB.prepare = prepare;

    const cache = new PlatformCache(env, 'art_1');
    expect(await cache.invalidate({ key: 'missing' })).toBe(0);
  });

  it('returns zero when persisted invalidation has no matching scope', async () => {
    prepare = mockDb();
    env.DB.prepare = prepare;

    const cache = new PlatformCache(env, 'art_1');
    expect(await cache.invalidate({})).toBe(0);
    expect(prepare).not.toHaveBeenCalled();
  });
});

describe('PlatformCache persisted layer (r2)', () => {
  beforeEach(() => {
    env.DB.prepare = mockDb();
    vi.mocked(env.ARTIFACTS.get).mockReset();
    vi.mocked(env.ARTIFACTS.put).mockResolvedValue(undefined);
    vi.mocked(env.ARTIFACTS.delete).mockResolvedValue(undefined);
  });

  it('reads and writes cache entries through R2', async () => {
    const persisted = sampleEntry({ queryHash: 'r2-key', data: { from: 'r2' } });
    vi.mocked(env.ARTIFACTS.get).mockResolvedValue({
      json: vi.fn().mockResolvedValue(persisted),
    } as Awaited<ReturnType<Env['ARTIFACTS']['get']>>);

    const cache = new PlatformCache(env, 'art_1', { persistedType: 'r2' });
    const entry = await cache.get('r2-key');

    expect(entry?.data).toEqual({ from: 'r2' });
    expect(env.ARTIFACTS.get).toHaveBeenCalledWith('platform_cache/art_1/r2-key');

    await cache.set('r2-write', { saved: true }, {
      ttlMs: 60_000,
      provider: 'shopify',
      endpoint: 'orders.list',
      persist: true,
      userRefreshable: false,
    });

    expect(env.ARTIFACTS.put).toHaveBeenCalledWith(
      'platform_cache/art_1/r2-write',
      expect.stringContaining('"saved":true'),
      { httpMetadata: { contentType: 'application/json' } }
    );
  });

  it('returns null when R2 object is missing', async () => {
    vi.mocked(env.ARTIFACTS.get).mockResolvedValue(null);

    const cache = new PlatformCache(env, 'art_1', { persistedType: 'r2' });
    await expect(cache.get('missing-r2-key')).resolves.toBeNull();
  });

  it('invalidates persisted R2 objects by key', async () => {
    const cache = new PlatformCache(env, 'art_1', { persistedType: 'r2' });

    expect(await cache.invalidate({ key: 'r2-delete' })).toBe(1);
    expect(env.ARTIFACTS.delete).toHaveBeenCalledWith('platform_cache/art_1/r2-delete');
  });

  it('does not bulk-invalidate R2 objects by provider pattern', async () => {
    vi.mocked(env.ARTIFACTS.delete).mockClear();

    const cache = new PlatformCache(env, 'art_1', { persistedType: 'r2' });

    expect(await cache.invalidate({ provider: 'shopify' })).toBe(0);
    expect(env.ARTIFACTS.delete).not.toHaveBeenCalled();
  });

  it('swallows R2 write failures', async () => {
    vi.mocked(env.ARTIFACTS.put).mockRejectedValue(new Error('r2 unavailable'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const cache = new PlatformCache(env, 'art_1', { persistedType: 'r2' });
    await cache.set('r2-fail', { ok: true }, {
      ttlMs: 60_000,
      provider: 'shopify',
      endpoint: 'orders.list',
      persist: true,
      userRefreshable: false,
    });

    expect(errorSpy).toHaveBeenCalledWith('Failed to write to persisted cache:', expect.any(Error));
    errorSpy.mockRestore();
  });
});
