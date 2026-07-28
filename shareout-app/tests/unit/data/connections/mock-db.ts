/**
 * In-memory D1 mock for connections handler unit tests.
 *
 * Implements the subset of SQL used by `src/data/connections/handler.ts` so
 * suites can assert on connection and cache side effects without spinning up a
 * real D1 database. Credentials are inline on the connection row; a `credentials`
 * seed is folded into the row that used to point at it via `credentials_id`.
 *
 * @module tests/unit/data/connections/mock-db
 */
import { vi } from 'vitest';
import type { Env } from '../../../../src/types';
import { ARTIFACT_ID } from './shared';

export interface StoredConnection {
  id: string;
  scope_type: 'artifact' | 'workspace';
  scope_id: string;
  name: string;
  kind: string;
  provider: string;
  auth_type: string | null;
  config: string;
  encrypted_credentials: string | null;
  iv: string | null;
  cache_ttl_seconds: number;
  rate_limit_rpm: number;
  created_at: string;
  updated_at: string;
  /** Seed-only: links a `credentials` seed to this row. Never read by the handlers. */
  credentials_id?: string | null;
}

export interface StoredCredential {
  id: string;
  artifact_id: string;
  type: string;
  encrypted_data: string;
  iv: string;
  created_at: string;
  updated_at: string;
}

export interface CacheRow {
  connection_id: string;
  query_hash: string;
  r2_key: string;
  expires_at: string;
}

export interface ConnectionsDbBundle {
  DB: Env['DB'];
  connections: StoredConnection[];
  credentials: StoredCredential[];
  cache: CacheRow[];
}

/** Default REST connection row reused across CRUD and query suites. */
export const sampleRestConnection: StoredConnection = {
  id: 'con_sample',
  scope_type: 'artifact',
  scope_id: ARTIFACT_ID,
  name: 'my_api',
  kind: 'generic',
  provider: 'rest_api',
  auth_type: null,
  encrypted_credentials: null,
  iv: null,
  config: JSON.stringify({
    baseUrl: 'https://api.example.com',
    healthEndpoint: '/health',
    apiKeyHeader: 'X-Api-Key',
    apiKeyPrefix: '',
  }),
  credentials_id: 'crd_sample',
  cache_ttl_seconds: 300,
  rate_limit_rpm: 60,
  created_at: '2026-05-30T14:00:00.000Z',
  updated_at: '2026-05-30T14:00:00.000Z',
};

export function createConnectionsDb(initial?: {
  connections?: StoredConnection[];
  credentials?: StoredCredential[];
  cache?: CacheRow[];
}): ConnectionsDbBundle {
  const connections: StoredConnection[] = [...(initial?.connections ?? [])];
  const credentials: StoredCredential[] = [...(initial?.credentials ?? [])];
  // Fold seeded credentials onto their connection row — one table now.
  for (const cred of credentials) {
    const conn = connections.find((c) => c.credentials_id === cred.id);
    if (conn) {
      conn.auth_type = cred.type;
      conn.encrypted_credentials = cred.encrypted_data;
      conn.iv = cred.iv;
    }
  }
  const cache: CacheRow[] = [...(initial?.cache ?? [])];

  const DB = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: unknown[]) => ({
        first: vi.fn(async () => dbFirst(sql, args, { connections, credentials, cache })),
        all: vi.fn(async () => {
          if (sql.includes('FROM connections') && sql.includes('ORDER BY name')) {
            const artifactId = args[0] as string;
            const results = connections
              .filter((c) => c.scope_id === artifactId)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((c) => ({ ...c, type: c.provider }));
            return { results };
          }
          if (sql.includes('SELECT r2_key FROM connection_cache WHERE connection_id = ?')) {
            const connectionId = args[0] as string;
            return {
              results: cache
                .filter((e) => e.connection_id === connectionId)
                .map((e) => ({ r2_key: e.r2_key })),
            };
          }
          return { results: [] };
        }),
        run: vi.fn(async () => {
          dbRun(sql, args, { connections, credentials, cache });
          return { success: true, meta: { changes: 1 } };
        }),
      })),
    })),
  } as unknown as Env['DB'];

  return { DB, connections, credentials, cache };
}

function dbFirst(
  sql: string,
  args: unknown[],
  store: {
    connections: StoredConnection[];
    credentials: StoredCredential[];
    cache: CacheRow[];
  },
): unknown {
  const { connections, credentials, cache } = store;

  if (sql.includes('SELECT id FROM connections')) {
    const [artifactId, name] = args as [string, string];
    const conn = connections.find((c) => c.scope_id === artifactId && c.name === name);
    return conn ? { id: conn.id } : null;
  }

  if (sql.includes('SELECT name, provider AS type, config, cache_ttl_seconds')) {
    const [artifactId, name] = args as [string, string];
    const conn = connections.find((c) => c.scope_id === artifactId && c.name === name);
    return conn ? { ...conn, type: conn.provider } : null;
  }

  // Resolution read: provider aliased to `type`, credentials inline.
  if (sql.includes('encrypted_credentials AS encrypted_data')) {
    const [artifactId, name] = args as [string, string];
    const conn = connections.find((c) => c.scope_id === artifactId && c.name === name);
    if (!conn) return null;
    return {
      ...conn,
      type: conn.provider,
      encrypted_data: conn.encrypted_credentials,
      iv: conn.iv,
      cred_type: conn.auth_type,
    };
  }

  if (sql.includes('SELECT r2_key, expires_at FROM connection_cache')) {
    const [connectionId, queryHash] = args as [string, string];
    return (
      cache.find(
        (e) =>
          e.connection_id === connectionId &&
          e.query_hash === queryHash &&
          e.expires_at > new Date().toISOString(),
      ) ?? null
    );
  }

  return null;
}

function dbRun(
  sql: string,
  args: unknown[],
  store: {
    connections: StoredConnection[];
    credentials: StoredCredential[];
    cache: CacheRow[];
  },
): void {
  const { connections, credentials, cache } = store;

  if (sql.includes('INSERT INTO connections')) {
    // (id, scope_id, name, provider, auth_type, config, encrypted, iv, ttl, rpm, created, updated)
    const [
      id,
      artifactId,
      name,
      provider,
      authType,
      config,
      encrypted,
      iv,
      cacheTtl,
      rateLimit,
      createdAt,
      updatedAt,
    ] = args as (string | number | null)[];
    connections.push({
      id: id as string,
      scope_type: 'artifact',
      scope_id: artifactId as string,
      name: name as string,
      kind: 'generic',
      provider: provider as string,
      auth_type: authType as string | null,
      config: config as string,
      encrypted_credentials: encrypted as string | null,
      iv: iv as string | null,
      cache_ttl_seconds: cacheTtl as number,
      rate_limit_rpm: rateLimit as number,
      created_at: createdAt as string,
      updated_at: updatedAt as string,
    });
    return;
  }

  if (sql.includes('UPDATE connections SET')) {
    const connId = args[args.length - 1] as string;
    const conn = connections.find((c) => c.id === connId);
    if (!conn) return;
    const sqlFields = sql.match(/(\w+) = \?/g) ?? [];
    let argIdx = 0;
    for (const field of sqlFields) {
      const col = field.split(' ')[0];
      const value = args[argIdx++];
      if (col === 'updated_at') conn.updated_at = value as string;
      if (col === 'config') conn.config = value as string;
      if (col === 'cache_ttl_seconds') conn.cache_ttl_seconds = value as number;
      if (col === 'rate_limit_rpm') conn.rate_limit_rpm = value as number;
      if (col === 'auth_type') conn.auth_type = value as string;
      if (col === 'encrypted_credentials') conn.encrypted_credentials = value as string;
      if (col === 'iv') conn.iv = value as string;
    }
    return;
  }

  if (sql.includes('DELETE FROM connection_cache WHERE connection_id = ?')) {
    const connectionId = args[0] as string;
    for (let i = cache.length - 1; i >= 0; i--) {
      if (cache[i].connection_id === connectionId) cache.splice(i, 1);
    }
    return;
  }

  if (sql.includes('DELETE FROM connections WHERE id = ?')) {
    const id = args[0] as string;
    const idx = connections.findIndex((c) => c.id === id);
    if (idx !== -1) connections.splice(idx, 1);
  }
}
