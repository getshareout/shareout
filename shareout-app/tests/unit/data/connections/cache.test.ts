// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cacheResult,
  getCachedResult,
  invalidateCache,
} from '../../../../src/data/connections/cache';
import type { Env } from '../../../../src/types';

let idSeq = 0;

vi.mock('../../../../src/crypto-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/crypto-utils')>();
  return {
    ...actual,
    generateId: vi.fn((prefix: string) => `${prefix}_id${++idSeq}`),
  };
});

interface CacheRow {
  id: string;
  connection_id: string;
  query_hash: string;
  r2_key: string;
  size_bytes: number;
  row_count: number | null;
  expires_at: string;
  created_at: string;
}

function createCacheEnv(initial?: { cache?: CacheRow[]; r2?: Record<string, unknown> }) {
  const cache: CacheRow[] = [...(initial?.cache ?? [])];
  const r2 = new Map<string, unknown>(Object.entries(initial?.r2 ?? {}));

  const DB = {
    prepare: vi.fn((sql: string) => {
      const runHandler = async (args: unknown[] = []) => {
          if (sql.includes('DELETE FROM connection_cache WHERE connection_id = ? AND query_hash = ?')) {
            const [connectionId, queryHash] = args as [string, string];
            const before = cache.length;
            const remaining = cache.filter(
              (entry) => !(entry.connection_id === connectionId && entry.query_hash === queryHash)
            );
            cache.splice(0, cache.length, ...remaining);
            return { meta: { changes: before - cache.length } };
          }
          if (sql.includes('DELETE FROM connection_cache WHERE connection_id = ?')) {
            const [connectionId] = args as [string];
            const before = cache.length;
            const remaining = cache.filter((entry) => entry.connection_id !== connectionId);
            cache.splice(0, cache.length, ...remaining);
            return { meta: { changes: before - cache.length } };
          }
          if (sql.includes("DELETE FROM connection_cache WHERE expires_at <= datetime('now')")) {
            const now = new Date().toISOString();
            const before = cache.length;
            const remaining = cache.filter((entry) => entry.expires_at > now);
            cache.splice(0, cache.length, ...remaining);
            return { meta: { changes: before - cache.length } };
          }
          if (sql.includes('INSERT INTO connection_cache')) {
            const [
              id,
              connectionId,
              queryHash,
              r2Key,
              sizeBytes,
              rowCount,
              expiresAt,
              createdAt,
            ] = args as [string, string, string, string, number, number | null, string, string];
            const existingIdx = cache.findIndex(
              (entry) => entry.connection_id === connectionId && entry.query_hash === queryHash
            );
            const row: CacheRow = {
              id,
              connection_id: connectionId,
              query_hash: queryHash,
              r2_key: r2Key,
              size_bytes: sizeBytes,
              row_count: rowCount,
              expires_at: expiresAt,
              created_at: createdAt,
            };
            if (existingIdx >= 0) {
              cache[existingIdx] = row;
            } else {
              cache.push(row);
            }
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 0 } };
      };

      const allHandler = async (args: unknown[] = []) => {
          if (sql.includes('SELECT r2_key FROM connection_cache WHERE connection_id = ?')) {
            const [connectionId] = args as [string];
            return {
              results: cache
                .filter((entry) => entry.connection_id === connectionId)
                .map((entry) => ({ r2_key: entry.r2_key })),
            };
          }
          if (sql.includes('SELECT r2_key FROM connection_cache WHERE expires_at <= datetime')) {
            const now = new Date().toISOString();
            return {
              results: cache
                .filter((entry) => entry.expires_at <= now)
                .map((entry) => ({ r2_key: entry.r2_key })),
            };
          }
          return { results: [] };
      };

      return {
        bind: vi.fn((...args: unknown[]) => ({
          first: vi.fn(async () => {
            if (sql.includes('SELECT r2_key, expires_at FROM connection_cache')) {
              const [connectionId, queryHash] = args as [string, string];
              const row = cache.find(
                (entry) =>
                  entry.connection_id === connectionId &&
                  entry.query_hash === queryHash &&
                  entry.expires_at > new Date().toISOString()
              );
              return row ? { r2_key: row.r2_key, expires_at: row.expires_at } : null;
            }
            return null;
          }),
          all: vi.fn(async () => allHandler(args)),
          run: vi.fn(async () => runHandler(args)),
        })),
        all: vi.fn(async () => allHandler()),
        run: vi.fn(async () => runHandler()),
      };
    }),
  } as unknown as Env['DB'];

  const ARTIFACTS = {
    get: vi.fn(async (key: string) => {
      if (!r2.has(key)) return null;
      return {
        json: async () => r2.get(key),
      };
    }),
    put: vi.fn(async (key: string, content: string) => {
      r2.set(key, JSON.parse(content));
    }),
    delete: vi.fn(async (key: string) => {
      r2.delete(key);
    }),
  } as unknown as Env['ARTIFACTS'];

  return { env: { DB, ARTIFACTS } as unknown as Env, cache, r2 };
}

beforeEach(() => {
  idSeq = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('getCachedResult', () => {
  it('returns null when no cache row exists', async () => {
    const { env } = createCacheEnv();
    await expect(getCachedResult(env, 'conn_1', 'SELECT 1')).resolves.toBeNull();
  });

  it('returns parsed JSON from R2 when cache is valid', async () => {
    const { env } = createCacheEnv();
    const payload = [{ id: 1 }];
    await cacheResult(env, 'conn_1', 'SELECT 1', undefined, payload, 300);

    await expect(getCachedResult(env, 'conn_1', 'SELECT 1')).resolves.toEqual(payload);
  });

  it('separates cache entries by params', async () => {
    const { env } = createCacheEnv();
    const acme = [{ project: 'acme' }];
    const northwind = [{ project: 'northwind' }];
    await cacheResult(env, 'conn_1', '/2.0/events/names', { project_id: '3212168' }, acme, 300);
    await cacheResult(env, 'conn_1', '/2.0/events/names', { project_id: '446209' }, northwind, 300);

    await expect(getCachedResult(env, 'conn_1', '/2.0/events/names', { project_id: '3212168' })).resolves.toEqual(acme);
    await expect(getCachedResult(env, 'conn_1', '/2.0/events/names', { project_id: '446209' })).resolves.toEqual(northwind);
    await expect(getCachedResult(env, 'conn_1', '/2.0/events/names', { project_id: '999999' })).resolves.toBeNull();
  });

  it('deletes stale cache rows when R2 object is missing', async () => {
    const { env, cache, r2 } = createCacheEnv();
    await cacheResult(env, 'conn_1', { sql: 'SELECT 1' }, undefined, { ok: true }, 300);
    expect(cache).toHaveLength(1);

    const r2Key = cache[0].r2_key;
    r2.delete(r2Key);

    await expect(getCachedResult(env, 'conn_1', { sql: 'SELECT 1' })).resolves.toBeNull();
    expect(cache).toHaveLength(0);
  });
});

describe('cacheResult', () => {
  it('stores result in R2 and upserts cache metadata', async () => {
    const { env, cache, r2 } = createCacheEnv();
    const rows = [{ id: 'a' }, { id: 'b' }];

    await cacheResult(env, 'conn_1', 'SELECT * FROM users', undefined, rows, 300);

    expect(r2.size).toBe(1);
    expect(cache).toHaveLength(1);
    expect(cache[0].connection_id).toBe('conn_1');
    expect(cache[0].row_count).toBe(2);
    expect(env.ARTIFACTS.put).toHaveBeenCalledTimes(1);
  });

  it('updates existing cache entry on conflict', async () => {
    const { env, cache } = createCacheEnv();
    await cacheResult(env, 'conn_1', 'SELECT 1', undefined, [1], 60);
    await cacheResult(env, 'conn_1', 'SELECT 1', undefined, [1, 2, 3], 120);

    expect(cache).toHaveLength(1);
    expect(cache[0].row_count).toBe(3);
  });
});

describe('invalidateCache', () => {
  it('deletes all R2 objects and cache rows for a connection', async () => {
    const { env, cache, r2 } = createCacheEnv({
      cache: [
        {
          id: 'cch_1',
          connection_id: 'conn_1',
          query_hash: 'h1',
          r2_key: 'cache/conn_1/h1',
          size_bytes: 1,
          row_count: null,
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          created_at: new Date().toISOString(),
        },
        {
          id: 'cch_2',
          connection_id: 'conn_1',
          query_hash: 'h2',
          r2_key: 'cache/conn_1/h2',
          size_bytes: 1,
          row_count: null,
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          created_at: new Date().toISOString(),
        },
      ],
      r2: {
        'cache/conn_1/h1': { ok: 1 },
        'cache/conn_1/h2': { ok: 2 },
      },
    });

    const deleted = await invalidateCache(env, 'conn_1');

    expect(deleted).toBe(2);
    expect(cache).toHaveLength(0);
    expect(r2.size).toBe(0);
    expect(env.ARTIFACTS.delete).toHaveBeenCalledTimes(2);
  });
});
