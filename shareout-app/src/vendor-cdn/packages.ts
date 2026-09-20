/**
 * Who decides which npm packages this instance will vendor.
 *
 * Three layers, each for a different person:
 *   1. the built-in set in registry.ts — the curated default,
 *   2. `VENDOR_PACKAGES_EXTRA` / `VENDOR_ALLOW_ANY` — the operator of a self-hosted
 *      instance, who should not have to fork the product to use their own library,
 *   3. the `vendor_packages` table — a workspace admin, adding what their own
 *      artifacts need without an env change or a deploy.
 *
 * Serving is instance-wide: `/vendor` resolves before any artifact or workspace is
 * known, and the bytes are public npm code, not workspace data. The workspace scope
 * decides what publish rewrites for that workspace's artifacts, and who owns the row.
 */
import type { Env } from '../types';
import { VENDOR_PACKAGES } from './registry';

const CACHE_TTL = 300;

/** Instances that would rather vendor anything on npm than maintain a list. */
export function vendorAllowsAny(env: Env): boolean {
  return env.VENDOR_ALLOW_ANY === '1';
}

export function instanceExtraPackages(env: Env): Set<string> {
  return new Set(
    (env.VENDOR_PACKAGES_EXTRA || '')
      .split(',')
      .map(p => p.trim())
      .filter(Boolean),
  );
}

// npm's own naming rules, minus the length edge cases: one optional @scope/ segment.
const PACKAGE_RE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;

export function isValidPackageName(pkg: string): boolean {
  return pkg.length <= 214 && PACKAGE_RE.test(pkg);
}

const cacheKey = (workspaceId: string | null) =>
  workspaceId ? `vendorpkgs:ws:${workspaceId}` : 'vendorpkgs:all';

async function readRegistered(env: Env, workspaceId: string | null): Promise<string[]> {
  const key = cacheKey(workspaceId);
  if (env.SLUGS) {
    try {
      const hit = await env.SLUGS.get<string[]>(key, 'json');
      if (hit) return hit;
    } catch { /* fall through to D1 */ }
  }
  const rows = workspaceId
    ? await env.DB.prepare('SELECT package FROM vendor_packages WHERE workspace_id = ?')
        .bind(workspaceId).all<{ package: string }>()
    : await env.DB.prepare('SELECT DISTINCT package FROM vendor_packages').all<{ package: string }>();
  const packages = (rows.results ?? []).map(r => r.package);
  if (env.SLUGS) {
    try { await env.SLUGS.put(key, JSON.stringify(packages), { expirationTtl: CACHE_TTL }); } catch { /* best effort */ }
  }
  return packages;
}

export async function invalidatePackageCache(env: Env, workspaceId: string): Promise<void> {
  if (!env.SLUGS) return;
  await Promise.all([
    env.SLUGS.delete(cacheKey(workspaceId)).catch(() => {}),
    env.SLUGS.delete(cacheKey(null)).catch(() => {}),
  ]);
}

/**
 * Serve-path check. The built-in and operator layers answer synchronously, so the hot
 * path (a curated package) never touches KV or D1 — only an unrecognised package pays
 * for the lookup, and the route sits behind the shared-bundle edge cache anyway.
 */
export async function isPackageAllowed(env: Env, pkg: string): Promise<boolean> {
  if (VENDOR_PACKAGES.has(pkg)) return true;
  if (vendorAllowsAny(env)) return isValidPackageName(pkg);
  if (instanceExtraPackages(env).has(pkg)) return true;
  try {
    return (await readRegistered(env, null)).includes(pkg);
  } catch {
    return false;
  }
}

/** Publish-path set: what this workspace's artifacts get rewritten to. */
export async function resolveAllowedPackages(
  env: Env,
  workspaceId: string | null,
): Promise<ReadonlySet<string>> {
  const allowed = new Set<string>([...VENDOR_PACKAGES, ...instanceExtraPackages(env)]);
  if (!workspaceId) return allowed;
  try {
    for (const pkg of await readRegistered(env, workspaceId)) allowed.add(pkg);
  } catch { /* the built-in + operator layers still apply */ }
  return allowed;
}
