/**
 * Workspace slug → id, cached in KV for subdomain routing. Only the id mapping is
 * cached; every access decision still runs on the id. Writers that create, rename or
 * delete a workspace call invalidateWorkspaceSlug; the TTLs bound any missed path.
 *
 * Only hits go to KV: their writes are bounded by the number of real workspaces.
 * Subdomains are wildcard, so misses are attacker-chosen; caching them in KV would
 * turn each random `<slug>.<apex>` into a paid KV write. Misses stay in a small
 * per-isolate map instead, and slugs no workspace could have skip D1 entirely.
 * A workspace created elsewhere can 404 on an isolate that cached its miss for up
 * to MISS_TTL_MS.
 */
import type { Env } from '../types';
import { deferWork, kvCacheGet } from '../kv-cache';
import { SLUG_REGEX } from './slug';

const HIT_TTL = 300;
const LEGACY_MISS = '-'; // negative KV entries from older builds; expire within 60s
const MISS_TTL_MS = 60_000;
const MISS_MAX = 1000;
const DNS_LABEL_MAX = 63;

const misses = new Map<string, number>();

export function workspaceSlugCacheKey(slug: string): string {
  return `wsslug:${slug.toLowerCase()}`;
}

/** Whether `slug` could name a workspace (the creation rule, within one DNS label). */
export function isWorkspaceSlugShape(slug: string): boolean {
  return slug.length <= DNS_LABEL_MAX && SLUG_REGEX.test(slug);
}

function isKnownMiss(slug: string, now: number): boolean {
  const expires = misses.get(slug);
  if (expires === undefined) return false;
  if (expires > now) return true;
  misses.delete(slug);
  return false;
}

function rememberMiss(slug: string, now: number): void {
  misses.delete(slug);
  if (misses.size >= MISS_MAX) misses.delete(misses.keys().next().value!);
  misses.set(slug, now + MISS_TTL_MS);
}

/** Size of this isolate's negative cache (tests). */
export function workspaceSlugMissCount(): number {
  return misses.size;
}

/** Forget this isolate's negative cache (tests). */
export function clearWorkspaceSlugMisses(): void {
  misses.clear();
}

export async function workspaceIdBySlug(env: Env, slug: string): Promise<string | null> {
  if (!isWorkspaceSlugShape(slug)) return null;
  const now = Date.now();
  if (isKnownMiss(slug, now)) return null;
  const key = workspaceSlugCacheKey(slug);
  const kv = env.SLUGS;
  if (kv) {
    try {
      const cached = await kvCacheGet(kv, key);
      if (cached && cached !== LEGACY_MISS) return cached;
    } catch { /* fail-open to D1 */ }
  }
  const row = await env.DB.prepare('SELECT id FROM workspaces WHERE slug = ?').bind(slug).first<{ id: string }>();
  const id = row?.id || null;
  if (!id) {
    rememberMiss(slug, now);
    return null;
  }
  if (kv) deferWork(() => kv.put(key, id, { expirationTtl: HIT_TTL }));
  return id;
}

/** Drop cached mappings for these slugs (old and new on a rename; the slug on create/delete). */
export async function invalidateWorkspaceSlug(env: Env, ...slugs: Array<string | null | undefined>): Promise<void> {
  const unique = [...new Set(slugs.filter((s): s is string => !!s))];
  for (const s of unique) misses.delete(s);
  const kv = env.SLUGS;
  if (!kv) return;
  await Promise.all(unique.map((s) =>
    kv.delete(workspaceSlugCacheKey(s)).catch(() => { /* best-effort */ })));
}
