import type { Env } from '../types';

// Shared namespace for object-addressed edge-cache keys (also used by serveAsset and
// the thumbnail/logo serve path). Blob/dataset r2_keys live in their own prefixes
// (`<artifactId>/blobs/...`, dataset keys) so they never collide with those.
const CACHE_HOST = 'https://artifact-cache.internal';

// Edge-cache read-through for public, immutable artifact bytes (uploaded blobs and
// dataset streams), keyed by the immutable R2 key. The key is minted once per object;
// a re-upload yields a new key and a delete abandons it, so the entry is
// self-invalidating per object — no purge needed (same property serveAsset relies on).
//
// ONLY call this for public artifacts. The shared edge cache is keyed by
// object, not by viewer, so caching private/workspace bytes would let anyone who learns
// the URL read them — keep those on the direct (uncached) path. (008 Stage A)
//
// Returns the cached or freshly-built Response, or null when the R2 object is missing
// so the caller can emit its own typed 404.
export async function serveCachedR2Bytes(
  env: Env,
  r2Key: string,
  buildResponse: (obj: R2ObjectBody) => Response,
  waitUntil?: (promise: Promise<unknown>) => void,
): Promise<Response | null> {
  const cache = caches.default;
  const cacheKey = new Request(`${CACHE_HOST}/${encodeURI(r2Key)}`, {
    method: 'GET',
    headers: { Accept: '*/*' },
  });

  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const obj = await env.ARTIFACTS.get(r2Key);
  if (!obj) return null;

  const response = buildResponse(obj);
  const toCache = response.clone();
  if (waitUntil) waitUntil(cache.put(cacheKey, toCache));
  else cache.put(cacheKey, toCache);

  return response;
}
