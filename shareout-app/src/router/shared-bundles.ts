import type { Env } from '../types';
import { handleServeSDK, handleServeCommentsAgent, handleServeChatCore, handleServePagePilot } from '../sdk-serve';
import { handleServeEditor } from '../editor-serve';
import { handleServeMobileSDK } from '../sdk-mobile-serve';
import { handleServeChartsSDK } from '../sdk-charts-serve';
import { handleServeArtifactCSS } from '../css-serve';
import { handleServeGridJS, handleServeGridCSS } from '../grid-serve';
import { handleServeArtifactUI } from '../ui-serve';
import { isSupportedSdkMajor } from '../sdk-version';
import { handleServeLibModule } from '../workspace-library';
import { handleServeVendorLib } from '../vendor-cdn';
import { isCurrentBundleVersion } from '../bundle-versions';

// Public, origin-independent SDK / static bundles. These resolve identically on the
// app origin and on each per-artifact content host (<hex>.shareoutcdn.site), so
// artifacts that reference the SDK by same-origin path (e.g. /sdk/shareout.js) keep
// working after the content-domain cutover (ADR 30) — otherwise that path resolves to
// the content host, which only serves artifact bytes, and the SDK 404s ("ShareOut is
// not defined"). No cookies or auth are involved; safe to serve from the locked-down
// content dispatcher.

// Edge-cache the shared bundle responses via the Cache API (016 Stage A). The bundles
// are auth-free and identical across every host, so a path key is safe and shared by
// all viewers in a colo. Repeat hits skip the bundle handler (and its ASSETS subrequest)
// entirely; the stored response honors its own Cache-Control max-age for expiry.
async function withEdgeCache(
  path: string,
  produce: () => Response | Promise<Response>,
  executionCtx?: ExecutionContext,
): Promise<Response> {
  const cache = caches.default;
  const cacheKey = new Request(`https://sdk-cache.internal${path}`, { method: 'GET' });

  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const res = await produce();
  if (res.ok) {
    const toCache = res.clone();
    if (executionCtx) executionCtx.waitUntil(cache.put(cacheKey, toCache));
    else await cache.put(cacheKey, toCache);
  }
  return res;
}

export function serveSharedBundle(
  request: Request,
  env: Env,
  path: string,
  executionCtx?: ExecutionContext,
): Response | Promise<Response> | null {
  if (request.method !== 'GET') return null;

  // `?v=<hash>` naming this deploy's bytes is immutable; any other request is the
  // short-TTL alias. The edge-cache key keeps the two apart (different headers).
  const v = new URL(request.url).searchParams.get('v');
  const pinned = isCurrentBundleVersion(path, v);
  const cacheKey = pinned ? `${path}?v=${v}` : path;

  // Versioned SDK paths (/sdk/v<major>/...) are immutable; the unversioned alias
  // (/sdk/...) floats to the current major for backward compat (ADR 29 / plan §9.4).
  const sdkMatch = path.match(
    /^\/sdk\/(?:v(\d+)\/)?(shareout\.js|shareout-mobile\.js|shareout-charts\.js|shareout\.css|shareout-ui\.js|grid\.js|grid\.css)$/
  );
  if (sdkMatch) {
    const major = sdkMatch[1] ? Number(sdkMatch[1]) : null;
    if (major !== null && !isSupportedSdkMajor(major)) {
      return new Response('Unknown SDK version', { status: 404 });
    }
    const immutable = major !== null || pinned;
    switch (sdkMatch[2]) {
      case 'shareout.js': {
        // handleServeSDK 403s document/navigate requests. Run that guard BEFORE the
        // cache lookup so a stored 200 (from a legit script GET) is never served to a
        // navigation GET — the 403 is a non-200 and is itself never cached.
        const secFetchDest = request.headers.get('Sec-Fetch-Dest');
        const secFetchMode = request.headers.get('Sec-Fetch-Mode');
        if (secFetchDest === 'document' || secFetchMode === 'navigate') {
          return new Response('Forbidden', { status: 403 });
        }
        return withEdgeCache(cacheKey, () => handleServeSDK(request, env, immutable), executionCtx);
      }
      case 'shareout-mobile.js':
        return withEdgeCache(path, () => handleServeMobileSDK(request, env, immutable), executionCtx);
      case 'shareout-charts.js':
        return withEdgeCache(path, () => handleServeChartsSDK(request, immutable), executionCtx);
      case 'shareout.css':
        return withEdgeCache(path, () => handleServeArtifactCSS(request, immutable), executionCtx);
      case 'shareout-ui.js':
        return withEdgeCache(path, () => handleServeArtifactUI(request, immutable), executionCtx);
      case 'grid.js':
        return withEdgeCache(path, () => handleServeGridJS(request, env, immutable), executionCtx);
      case 'grid.css':
        return withEdgeCache(path, () => handleServeGridCSS(request, env, immutable), executionCtx);
    }
  }

  // Workspace Library modules: /lib/<scope>/<name>@<semver>.js. Pinned semver bytes are
  // immutable and public, so they share the same auth-free edge-cache rail as the SDK
  // and resolve same-origin on every content host. A non-/lib path returns null inside
  // the handler (dispatcher falls through); 404s are non-200 and never cached.
  if (path.startsWith('/lib/'))
    return withEdgeCache(path, () => handleServeLibModule(request, env, path).then(r => r ?? new Response('Not found', { status: 404 })), executionCtx);

  // Vendored public libraries: /vendor/<pkg>@<version>/<file>. Same auth-free,
  // version-addressed rail as the SDK and Workspace Library — an artifact loads its
  // chart library from us instead of a third-party CDN, so the bytes are edge-cached
  // and no extra origin is on the critical path.
  if (path.startsWith('/vendor/'))
    return withEdgeCache(path, () => handleServeVendorLib(request, env, path, executionCtx).then(r => r ?? new Response('Not found', { status: 404 })), executionCtx);

  if (path === '/sdk/editor.js')
    return withEdgeCache(cacheKey, () => handleServeEditor(request, env, pinned), executionCtx);
  if (path === '/sdk/comments-agent.js')
    return withEdgeCache(cacheKey, () => handleServeCommentsAgent(request, env, pinned), executionCtx);
  if (path === '/sdk/chat-core.js')
    return withEdgeCache(cacheKey, () => handleServeChatCore(request, env, pinned), executionCtx);
  if (path === '/sdk/page-pilot.js')
    return withEdgeCache(path, () => handleServePagePilot(request, env), executionCtx);

  return null;
}
