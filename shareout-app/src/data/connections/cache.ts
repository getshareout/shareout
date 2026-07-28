import type { Env } from '../../types';
import { generateId, sha256 } from '../../crypto-utils';

interface CacheEntry {
  id: string;
  connection_id: string;
  query_hash: string;
  r2_key: string;
  size_bytes: number;
  row_count: number | null;
  expires_at: string;
  created_at: string;
}

export async function getCachedResult(
  env: Env,
  connectionId: string,
  query: string | Record<string, unknown>,
  params?: Record<string, unknown>
): Promise<unknown | null> {
  const queryHash = await hashQuery(query, params);

  const cached = await env.DB.prepare(`
    SELECT r2_key, expires_at FROM connection_cache
    WHERE connection_id = ? AND query_hash = ? AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')
  `).bind(connectionId, queryHash).first<CacheEntry>();

  if (!cached) {
    return null;
  }

  const obj = await env.ARTIFACTS.get(cached.r2_key);
  if (!obj) {
    await env.DB.prepare(
      'DELETE FROM connection_cache WHERE connection_id = ? AND query_hash = ?'
    ).bind(connectionId, queryHash).run();
    return null;
  }

  return obj.json();
}

export async function cacheResult(
  env: Env,
  connectionId: string,
  query: string | Record<string, unknown>,
  params: Record<string, unknown> | undefined,
  result: unknown,
  ttlSeconds: number
): Promise<void> {
  const queryHash = await hashQuery(query, params);
  const content = JSON.stringify(result);
  const sizeBytes = new TextEncoder().encode(content).length;

  const r2Key = `cache/${connectionId}/${queryHash}`;
  await env.ARTIFACTS.put(r2Key, content, {
    httpMetadata: { contentType: 'application/json' },
  });

  const id = generateId('cch');
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const now = new Date().toISOString();

  const rowCount = Array.isArray(result) ? result.length : null;

  await env.DB.prepare(`
    INSERT INTO connection_cache (id, connection_id, query_hash, r2_key, size_bytes, row_count, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(connection_id, query_hash) DO UPDATE SET
      r2_key = excluded.r2_key,
      size_bytes = excluded.size_bytes,
      row_count = excluded.row_count,
      expires_at = excluded.expires_at
  `).bind(id, connectionId, queryHash, r2Key, sizeBytes, rowCount, expiresAt, now).run();
}

export async function invalidateCache(
  env: Env,
  connectionId: string
): Promise<number> {
  const entries = await env.DB.prepare(
    'SELECT r2_key FROM connection_cache WHERE connection_id = ?'
  ).bind(connectionId).all<{ r2_key: string }>();

  for (const entry of entries.results) {
    await env.ARTIFACTS.delete(entry.r2_key);
  }

  const result = await env.DB.prepare(
    'DELETE FROM connection_cache WHERE connection_id = ?'
  ).bind(connectionId).run();

  return result.meta.changes;
}

async function hashQuery(
  query: string | Record<string, unknown>,
  params?: Record<string, unknown>
): Promise<string> {
  const normalized = JSON.stringify({ query, params: params ?? null });
  const encoded = new TextEncoder().encode(normalized);
  return sha256(encoded.buffer as ArrayBuffer);
}
