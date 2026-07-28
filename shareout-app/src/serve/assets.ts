import type { Env } from '../types';
import { getSecurityHeaders, getSandboxedCSP, getArtifactCspOrigin } from './security';
import { notFound } from './utils';

function isCacheableAsset(mime: string): boolean {
  return (
    mime.startsWith('image/') ||
    mime.startsWith('video/') ||
    mime.startsWith('audio/') ||
    mime.startsWith('font/') ||
    mime === 'text/css' ||
    mime.includes('javascript') ||
    mime === 'application/wasm'
  );
}

function parseRange(rangeHeader: string, totalSize: number): { offset: number; length: number } | undefined {
  const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);
  if (!match) return undefined;

  const start = match[1] ? parseInt(match[1], 10) : 0;
  const end = match[2] ? parseInt(match[2], 10) : totalSize - 1;

  if (start >= totalSize || end >= totalSize || start > end) {
    return undefined;
  }

  return { offset: start, length: end - start + 1 };
}

export function getCacheControl(mime: string): string {
  if (mime.startsWith('image/') || mime.startsWith('video/') || mime.startsWith('audio/') || mime.startsWith('font/')) {
    return 'public, max-age=31536000, immutable';
  }
  if (mime === 'text/html') {
    return 'public, max-age=0, must-revalidate';
  }
  return 'public, max-age=86400';
}

export async function serveAsset(
  request: Request,
  env: Env,
  asset: { r2_key: string; mime: string; size_bytes: number },
  _slug: string,
  _isRawRequest: boolean,
  // noStore: private artifact bytes served on the content domain must never enter a
  // shared cache (the edge cache is keyed by r2_key, not by the capability token), so
  // skip the edge cache and mark the response `private, no-store` (ADR 30).
  // cacheHtml: opt in to edge-caching text/html (excluded by isCacheableAsset by
  // default). cacheVariant distinguishes bodies that differ for the same r2_key (e.g.
  // the comments-overlay agent), and transform mutates the HTML body before it is
  // cached so the post-HTMLRewriter result is what gets stored and re-served (007).
  opts: {
    noStore?: boolean;
    cacheHtml?: boolean;
    cacheVariant?: string;
    transform?: (resp: Response) => Response;
    // relaxCsp: private/authed-only artifact — loosen the sandbox script/style/font-src
    // to any https host (see getSandboxedCSP). Only ever set on non-cacheable (noStore)
    // responses, so a relaxed CSP can't leak into the shared edge cache.
    relaxCsp?: boolean;
  } = {},
): Promise<Response> {
  const rangeHeader = request.headers.get('Range');
  const cache = caches.default;
  const noStore = opts.noStore === true;
  const cacheHtml = opts.cacheHtml === true;
  const transform = opts.transform;
  // relaxCsp rides the variant so a relaxed (private) body and a tight (public) body
  // for the same r2_key never share a cache entry across a visibility flip.
  const variantSuffix =
    (opts.cacheVariant ? `:${opts.cacheVariant}` : '') + (opts.relaxCsp ? ':relax' : '');

  // Edge-cache gate: assets always cacheable by mime, plus opt-in HTML. Private
  // (noStore) and ranged responses are never cached.
  const cacheable = !noStore && !rangeHeader && (isCacheableAsset(asset.mime) || cacheHtml);

  // Strong validator: r2_key is unique per (version, path), so it changes whenever a
  // new version is published/promoted — cheap revalidation and correct invalidation.
  // The variant rides the ETag so a comments-overlay flip busts client revalidation.
  const etag = `"${asset.r2_key}${variantSuffix}"`;

  // Cache-first read path (plan §6.4): key the edge cache by the version-addressed
  // r2_key (plus variant), not the slug URL. A promote to a new version yields a new
  // key, so old entries are abandoned per deployment rather than served stale or
  // blanket-flushed.
  const cacheKey = new Request(`https://artifact-cache.internal/${encodeURI(asset.r2_key + variantSuffix)}`, {
    method: 'GET',
    headers: { Accept: asset.mime },
  });

  if (!rangeHeader && request.headers.get('If-None-Match') === etag) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, 'Cache-Control': noStore ? 'private, no-store' : getCacheControl(asset.mime) },
    });
  }

  if (cacheable) {
    const cachedResponse = await cache.match(cacheKey);
    if (cachedResponse) {
      return cachedResponse;
    }
  }

  const obj = await env.ARTIFACTS.get(asset.r2_key, {
    range: rangeHeader ? parseRange(rangeHeader, asset.size_bytes) : undefined,
  });

  if (!obj) {
    return notFound();
  }

  const headers = new Headers();
  headers.set('Content-Type', asset.mime);
  headers.set('ETag', etag);

  const cacheControl = noStore
    ? 'private, no-store'
    : cacheHtml && asset.mime === 'text/html'
      // Immutable per r2_key: give the shared edge cache a real TTL (s-maxage) so it
      // actually stores/serves the HTML, while browsers keep revalidating (max-age=0)
      // — a comments-overlay flip changes the variant key + ETag, busting both caches.
      ? 'public, max-age=0, s-maxage=86400, must-revalidate'
      : (obj.httpMetadata?.cacheControl || getCacheControl(asset.mime));
  headers.set('Cache-Control', cacheControl);

  if (asset.mime === 'text/html') {
    Object.entries(getSecurityHeaders(true)).forEach(([k, v]) => headers.set(k, v));
    headers.set('Content-Security-Policy', getSandboxedCSP(getArtifactCspOrigin(env, request), opts.relaxCsp === true, env));
  } else {
    headers.set('X-Content-Type-Options', 'nosniff');
  }

  headers.set('Accept-Ranges', 'bytes');

  if (rangeHeader && obj.range) {
    const range = obj.range as { offset: number; length: number };
    headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${asset.size_bytes}`);
    headers.set('Content-Length', String(range.length));
    return new Response(obj.body, { status: 206, headers });
  }

  headers.set('Content-Length', String(asset.size_bytes));

  let response = new Response(obj.body, { status: 200, headers });

  // Apply the body transform (e.g. comments-overlay injection) before caching so the
  // stored entry is the final, post-HTMLRewriter HTML. Runs for private bytes too;
  // only the cache.put below is gated.
  if (transform) response = transform(response);

  if (cacheable) {
    const responseToCache = response.clone();
    cache.put(cacheKey, responseToCache);
  }

  return response;
}
