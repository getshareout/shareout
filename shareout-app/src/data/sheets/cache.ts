import type { Env } from '../../types';
import { DATA_ERRORS } from '../../types';
import { successResponse, errorResponse, verifyOwner, type DataContext } from '../middleware';
import { createMiniDb } from '../minidb-client';
import { generateId } from '../../crypto-utils';
import { CACHE_KEY_PREFIX, CACHE_TTL_MS } from './constants';

// Sheet read-cache lives in the per-artifact MiniDB `artifact_json` store (keyed
// under CACHE_KEY_PREFIX), NOT D1 — the D1 `artifact_json` table was dropped in
// migration 0039 when artifact json moved to the Durable Object. Querying D1 here
// threw `no such table: artifact_json` and 500'd every sheet fetch/update.

export function makeCacheKey(spreadsheetId: string, range: string): string {
  return `${CACHE_KEY_PREFIX}${spreadsheetId}_${range.replace(/[^a-zA-Z0-9]/g, '_')}`;
}

export async function getCachedSheetData(
  env: Env,
  artifactId: string,
  cacheKey: string
): Promise<{ data: unknown; cachedAt: string } | null> {
  const db = createMiniDb(env, artifactId, '');
  const row = await db.prepare(
    'SELECT value FROM artifact_json WHERE artifact_id = ? AND key = ?'
  ).bind(artifactId, cacheKey).first<{ value: string }>();

  if (!row) return null;

  try {
    const cached = JSON.parse(row.value);
    const cachedAt = new Date(cached.cachedAt);
    if (Date.now() - cachedAt.getTime() > CACHE_TTL_MS) {
      return null;
    }
    return cached;
  } catch {
    return null;
  }
}

export async function cacheSheetData(
  env: Env,
  artifactId: string,
  cacheKey: string,
  data: unknown
): Promise<void> {
  const db = createMiniDb(env, artifactId, '');
  const now = new Date().toISOString();
  const cacheValue = JSON.stringify({ data, cachedAt: now });
  const size = new TextEncoder().encode(cacheValue).length;

  await db.prepare(`
    INSERT INTO artifact_json (id, artifact_id, key, value, size_bytes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(artifact_id, key) DO UPDATE SET
      value = excluded.value,
      size_bytes = excluded.size_bytes,
      updated_at = excluded.updated_at
  `).bind(generateId('jsn'), artifactId, cacheKey, cacheValue, size, now, now).run();
}

export async function invalidateSheetCache(
  env: Env,
  artifactId: string,
  spreadsheetId: string
): Promise<void> {
  const db = createMiniDb(env, artifactId, '');
  await db.prepare(
    'DELETE FROM artifact_json WHERE artifact_id = ? AND key LIKE ?'
  ).bind(artifactId, `${CACHE_KEY_PREFIX}${spreadsheetId}%`).run();
}

export async function getCacheStatus(ctx: DataContext): Promise<Response> {
  const caches = await ctx.db.prepare(`
    SELECT key, json_extract(value, '$.cachedAt') as cachedAt,
           json_extract(value, '$.rowCount') as rowCount
    FROM artifact_json
    WHERE artifact_id = ? AND key LIKE ?
    ORDER BY key
  `).bind(ctx.artifactId, `${CACHE_KEY_PREFIX}%`).all<{ key: string; cachedAt: string; rowCount: number }>();

  return successResponse({
    caches: caches.results.map(c => ({
      key: c.key.replace(CACHE_KEY_PREFIX, ''),
      cachedAt: c.cachedAt,
      rowCount: c.rowCount,
    })),
    count: caches.results.length,
  });
}

export async function clearCache(
  request: Request,
  ctx: DataContext
): Promise<Response> {
  const isOwner = await verifyOwner(request, ctx);
  if (!isOwner) {
    return errorResponse(DATA_ERRORS.FORBIDDEN);
  }

  const url = new URL(request.url);
  const spreadsheetId = url.searchParams.get('spreadsheetId');

  if (spreadsheetId) {
    await invalidateSheetCache(ctx.env, ctx.artifactId, spreadsheetId);
  } else {
    await ctx.db.prepare(
      'DELETE FROM artifact_json WHERE artifact_id = ? AND key LIKE ?'
    ).bind(ctx.artifactId, `${CACHE_KEY_PREFIX}%`).run();
  }

  return successResponse({ cleared: true });
}
