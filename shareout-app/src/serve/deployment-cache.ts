import type { Env } from '../types';
import type { ArtifactInfo, CachedDeployment } from './types';

type EntryAssetRow = { r2_key: string; mime: string; size_bytes: number } | null;

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

export async function cacheDeployment(env: Env, slug: string, data: CachedDeployment): Promise<void> {
  if (!env.SLUGS) return;
  try {
    await env.SLUGS.put(`deploy:${slug}`, JSON.stringify(data), { expirationTtl: CACHE_TTL });
  } catch {
    // Ignore cache write failures
  }
}

/**
 * Invalidate every KV cache keyed off an artifact after a (re)publish: the
 * deployment pointer (`deploy:slug`) and the data-layer artifact cache
 * (`art:slug` / `art:id`, which holds visibility + access policy).
 *
 * A silently-dropped delete here serves stale content for the full CACHE_TTL
 * window, so each key gets one retry before giving up.
 */
export async function invalidateDeploymentCache(
  env: Env,
  slug: string,
  artifactId?: string
): Promise<void> {
  const kv = env.SLUGS;
  if (!kv) return;
  // art: = legacy data-layer cache; artv2: = current dataMiddleware cache shape
  // (migration 0080). Bust both so visibility / anon-access / moderation changes
  // take effect immediately rather than after the TTL.
  const keys = [`deploy:${slug}`, `art:${slug}`, `artv2:${slug}`];
  if (artifactId) keys.push(`art:${artifactId}`, `artv2:${artifactId}`);

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
