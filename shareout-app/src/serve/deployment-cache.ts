import type { Env } from '../types';
import type { ArtifactInfo, ArtifactWithAsset, CachedDeployment } from './types';

type EntryAssetRow = { r2_key: string; mime: string; size_bytes: number } | null;

/**
 * Deployment + artifact + one asset row in a single round-trip. The first bind is
 * the asset path (null = the version's entrypoint); callers append the WHERE.
 */
export const DEPLOYMENT_SELECT = `
  SELECT d.slug as deploy_slug, d.version_id, v.entrypoint, v.mobile_entrypoint, v.artifact_id, v.manifest_json,
         a.name as artifact_name,
         a.description, pres_a.social_title, pres_a.social_description, pres_a.social_image_url,
         pres_a.thumbnail_ext,
         a.visibility, a.auth_method, a.owner_id, a.workspace_id, a.paused,
         COALESCE(pres_a.has_mobile, 0) AS has_mobile, pres_a.pwa_config,
         a.artifact_type, a.type_metadata, a.access_policy,
         COALESCE(mod_a.status, 'approved') AS moderation_status,
         mod_a.held_visibility AS moderation_held_visibility,
         ast.r2_key, ast.mime, ast.size_bytes
  FROM deployments d
  JOIN versions v ON v.id = d.version_id
  JOIN artifacts a ON a.id = v.artifact_id
  LEFT JOIN artifact_moderation mod_a ON mod_a.artifact_id = a.id
  LEFT JOIN artifact_presentation pres_a ON pres_a.artifact_id = a.id
  LEFT JOIN assets ast ON ast.version_id = v.id
    AND ast.path = COALESCE(?, v.entrypoint)`;

/** Best-effort cache write: off the response path when the request has a ctx. */
async function settleCacheWrite(executionCtx: ExecutionContext | undefined, write: Promise<unknown>): Promise<void> {
  const safe = write.catch(() => {});
  if (executionCtx) executionCtx.waitUntil(safe);
  else await safe;
}

/** Fetch one asset row by (version_id, path). */
export async function fetchAssetRow(
  env: Env,
  versionId: string,
  path: string
): Promise<EntryAssetRow> {
  return env.DB.prepare(
    'SELECT r2_key, mime, size_bytes FROM assets WHERE version_id = ? AND path = ?'
  ).bind(versionId, path).first<{ r2_key: string; mime: string; size_bytes: number }>();
}

/**
 * Assemble the cache record from a deployment row plus its (immutable, per-version)
 * entrypoint asset rows. Centralized so every serve path writes the identical shape
 * — the HTML serve path trusts `entry_asset` / `access_policy` on a cache hit, so a
 * partially-filled record written by another path would break or leak.
 */
export function buildCacheRecord(
  info: ArtifactInfo,
  entryAsset: EntryAssetRow,
  mobileEntryAsset: EntryAssetRow
): CachedDeployment {
  return {
    version_id: info.version_id,
    entrypoint: info.entrypoint,
    mobile_entrypoint: info.mobile_entrypoint,
    artifact_id: info.artifact_id,
    artifact_name: info.artifact_name,
    description: info.description,
    social_title: info.social_title,
    social_description: info.social_description,
    social_image_url: info.social_image_url,
    thumbnail_ext: info.thumbnail_ext,
    visibility: info.visibility,
    auth_method: info.auth_method,
    owner_id: info.owner_id,
    workspace_id: info.workspace_id,
    paused: info.paused,
    has_mobile: info.has_mobile,
    pwa_config: info.pwa_config,
    artifact_type: info.artifact_type,
    type_metadata: info.type_metadata,
    access_policy: info.access_policy,
    manifest_json: info.manifest_json,
    moderation_status: info.moderation_status,
    moderation_held_visibility: info.moderation_held_visibility,
    entry_asset: entryAsset,
    mobile_entry_asset: mobileEntryAsset,
  };
}

// 1h. Publish/promote/CRUD already invalidate explicitly, and KV's own ~60s
// global propagation is the staleness floor either way — so a longer TTL only
// raises the steady-state hit rate, it does not widen the staleness window.
export const CACHE_TTL = 3600; // seconds

export async function getCachedDeployment(env: Env, slug: string): Promise<CachedDeployment | null> {
  if (!env.SLUGS) return null;
  try {
    return await env.SLUGS.get<CachedDeployment>(`deploy:${slug}`, 'json');
  } catch {
    return null;
  }
}

export async function cacheDeployment(
  env: Env,
  slug: string,
  data: CachedDeployment,
  executionCtx?: ExecutionContext
): Promise<void> {
  if (!env.SLUGS) return;
  await settleCacheWrite(executionCtx, env.SLUGS.put(`deploy:${slug}`, JSON.stringify(data), { expirationTtl: CACHE_TTL }));
}

/** A production deployment resolved from a public route: its routing slug + record. */
export interface RoutedDeployment {
  slug: string;
  record: CachedDeployment;
}

// Shorthand (`wsslug:`) and content-domain (`cdnslug:`) keys carry the whole record,
// not just the deploy slug, so an open is one KV read instead of a pointer read, a
// `deploy:` read and a D1 query per miss. Short TTL (renames and workspace moves
// self-heal); visibility / publish changes purge it via invalidateDeploymentCache.
export const ROUTE_CACHE_TTL = 300;

export const workspaceRouteKey = (workspaceSlug: string, displaySlug: string) =>
  `wsslug:${workspaceSlug}/${displaySlug}`;
export const contentRouteKey = (artifactId: string) => `cdnslug:${artifactId}`;

/**
 * Resolve a route key to its production deployment: one KV read on a hit, one
 * combined D1 query (+ the mobile entry row when present) on a miss. `where`
 * filters DEPLOYMENT_SELECT; positives only are cached.
 */
export async function resolveRoutedDeployment(
  env: Env,
  cacheKey: string,
  where: string,
  binds: unknown[],
  executionCtx?: ExecutionContext
): Promise<RoutedDeployment | null> {
  if (env.SLUGS) {
    try {
      const hit = await env.SLUGS.get<RoutedDeployment>(cacheKey, 'json');
      if (hit?.slug && hit.record && 'entry_asset' in hit.record) return hit;
    } catch {}
  }

  const row = await env.DB.prepare(`${DEPLOYMENT_SELECT} WHERE ${where} AND d.channel = 'production'`)
    .bind(null, ...binds).first<ArtifactWithAsset & { deploy_slug: string }>();
  if (!row?.deploy_slug) return null;

  const entryAsset = row.r2_key && row.mime && row.size_bytes
    ? { r2_key: row.r2_key, mime: row.mime, size_bytes: row.size_bytes }
    : null;
  const mobileEntryAsset = row.has_mobile && row.mobile_entrypoint
    ? await fetchAssetRow(env, row.version_id, row.mobile_entrypoint)
    : null;
  const routed = { slug: row.deploy_slug, record: buildCacheRecord(row, entryAsset, mobileEntryAsset) };

  if (env.SLUGS) {
    await settleCacheWrite(
      executionCtx,
      env.SLUGS.put(cacheKey, JSON.stringify(routed), { expirationTtl: ROUTE_CACHE_TTL })
    );
  }
  return routed;
}

/** Route keys currently pointing at an artifact (read before a hard delete drops the row). */
export async function routeCacheKeys(env: Env, artifactId: string): Promise<string[]> {
  const row = await env.DB.prepare(`
    SELECT a.display_slug, w.slug as workspace_slug
    FROM artifacts a LEFT JOIN workspaces w ON w.id = a.workspace_id
    WHERE a.id = ?
  `).bind(artifactId).first<{ display_slug: string | null; workspace_slug: string | null }>().catch(() => null);
  const keys = [contentRouteKey(artifactId)];
  if (row?.workspace_slug && row.display_slug) keys.push(workspaceRouteKey(row.workspace_slug, row.display_slug));
  return keys;
}

/**
 * Invalidate every KV cache keyed off an artifact after a (re)publish: the
 * deployment pointer (`deploy:slug`), the route records (`wsslug:` / `cdnslug:`)
 * and the data-layer artifact cache (`art:slug` / `art:id`, which holds visibility
 * + access policy). Pass `routeKeys` when the artifact row is already gone.
 *
 * A silently-dropped delete here serves stale content for the full CACHE_TTL
 * window, so each key gets one retry before giving up.
 */
export async function invalidateDeploymentCache(
  env: Env,
  slug: string,
  artifactId?: string,
  routeKeys?: string[]
): Promise<void> {
  const kv = env.SLUGS;
  if (!kv) return;
  // art: = legacy data-layer cache; artv2: = current dataMiddleware cache shape
  // (migration 0080). Bust both so visibility / anon-access / moderation changes
  // take effect immediately rather than after the TTL.
  const keys = [`deploy:${slug}`, `art:${slug}`, `artv2:${slug}`];
  if (artifactId) {
    keys.push(`art:${artifactId}`, `artv2:${artifactId}`);
    keys.push(...(routeKeys ?? await routeCacheKeys(env, artifactId)));
  }

  await Promise.all(
    keys.map(async (key) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await kv.delete(key);
          return;
        } catch {
          // transient KV failure — retry once, then give up
        }
      }
    })
  );
}

/**
 * Invalidate by artifact id when the caller has no slug. Resolves the production
 * slug first, mirroring the inline pattern in artifacts/crud.ts.
 */
export async function invalidateDeploymentCacheById(
  env: Env,
  artifactId: string
): Promise<void> {
  if (!env.SLUGS) return;
  const row = await env.DB.prepare(
    "SELECT slug FROM deployments WHERE artifact_id = ? AND channel = 'production'"
  ).bind(artifactId).first<{ slug: string }>().catch(() => null);
  await invalidateDeploymentCache(env, row?.slug ?? '', artifactId);
}
