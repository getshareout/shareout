/**
 * Workspace slug → id, cached in KV for subdomain routing. Only the id mapping is
 * cached; every access decision still runs on the id. Writers that create, rename or
 * delete a workspace call invalidateWorkspaceSlug; the TTLs bound any missed path.
 */
import type { Env } from '../types';
import { deferWork, kvCacheGet } from '../kv-cache';

const HIT_TTL = 300;
const MISS_TTL = 60; // KV's minimum expirationTtl
const MISS = '-';

export function workspaceSlugCacheKey(slug: string): string {
  return `wsslug:${slug.toLowerCase()}`;
}

export async function workspaceIdBySlug(env: Env, slug: string): Promise<string | null> {
  const key = workspaceSlugCacheKey(slug);
  const kv = env.SLUGS;
  if (kv) {
    try {
      const cached = await kvCacheGet(kv, key);
      if (cached) return cached === MISS ? null : cached;
    } catch { /* fail-open to D1 */ }
  }
  const row = await env.DB.prepare('SELECT id FROM workspaces WHERE slug = ?').bind(slug).first<{ id: string }>();
  const id = row?.id || null;
  if (kv) deferWork(() => kv.put(key, id ?? MISS, { expirationTtl: id ? HIT_TTL : MISS_TTL }));
  return id;
}

/** Drop cached mappings for these slugs (old and new on a rename; the slug on create/delete). */
export async function invalidateWorkspaceSlug(env: Env, ...slugs: Array<string | null | undefined>): Promise<void> {
  const kv = env.SLUGS;
  if (!kv) return;
  await Promise.all([...new Set(slugs.filter((s): s is string => !!s))].map((s) =>
    kv.delete(workspaceSlugCacheKey(s)).catch(() => { /* best-effort */ })));
}
