import type { Env } from '../types';
import type { ArtifactWithAsset } from './types';
import { getCachedDeployment, cacheDeployment, buildCacheRecord, fetchAssetRow } from './deployment-cache';
import { checkAccess } from './access';
import { normalizeVisibility } from '../visibility-config';
import { isMobileDevice, notFound, pausedPage, takedownPage, underReviewPage } from './utils';
import { serveSandboxedViewer } from './sandbox-viewer';
import { serveTypeViewer } from './type-viewer';
import { serveAsset } from './assets';
import { hasCustomViewer } from '../viewers';
import { resolveArtifactSocialPreview } from './social-meta';
import { verifyAccessToken, createAccessToken } from '../token';
import { isCommentsOverlayEnabled } from './comments-config';
import { injectPerfBeacon } from './perf-beacon';
import { injectPresenceBeacon } from './presence-beacon';
import { badgeEnabled, injectBadge } from './badge';

function injectCommentsAgent(resp: Response, baseUrl: string): Response {
  const tag = `<script src="${baseUrl}/sdk/comments-agent.js" defer></script>`;
  let injected = false;
  const append = { element(e: { append: (c: string, o: { html: boolean }) => void }) {
    if (injected) return;
    injected = true;
    e.append(tag, { html: true });
  } };
  return new HTMLRewriter().on('head', append).on('body', append).transform(resp);
}

// Capture mode: serve the bare artifact HTML at top-level (no sandbox iframe, no
// toolbar) so server-side screenshot/PDF can render the whole, data-loaded page.
// The artifact's SDK reads its auth from an inline #shareout-initial-data script
// (the wrapper normally supplies this via the iframe postMessage bridge); we
// inject the same here. Gated by a signed capture token only the renderer can
// mint, so the un-sandboxed origin is never reachable by the public.
async function serveCaptureView(
  request: Request,
  env: Env,
  asset: { r2_key: string; mime: string; size_bytes: number },
  slug: string,
  result: ArtifactWithAsset,
  baseUrl: string,
  // writable: mint a full-WRITE `owner` session instead of the read-only `owner_test`.
  // Used only by the crew `pilot_verify` flow, which drives the real UI (submit a
  // form, save a record) to catch UI regressions — it MUST be able to persist. Every
  // other capture render (thumbnail, smoke, PDF, report, test flow) stays read-only.
  writable = false,
): Promise<Response> {
  const owner = await env.DB.prepare('SELECT email FROM users WHERE id = ?')
    .bind(result.owner_id).first<{ email: string | null }>();
  // Read-only capture uses `owner_test` (reads as owner, router blocks every write).
  // The pilot_verify path uses a real `owner` session so its in-page run can submit.
  // A full-WRITE credential must not outlive its ≤90s run, so the writable session
  // gets a tight 120s TTL; the read-only owner_test keeps the long 2h window.
  const sessionTtlSec = writable ? 120 : 60 * 60 * 2;
  const sessionToken = await createAccessToken(
    result.artifact_id, writable ? 'owner' : 'owner_test', env, sessionTtlSec, owner?.email ?? undefined,
  );
  const initial = { artifactId: result.artifact_id, baseUrl, sessionToken };
  const json = JSON.stringify(initial).replace(/</g, '\\u003c');
  const scriptTag = `<script id="shareout-initial-data" type="application/json">${json}</script>`;

  // Owner-authorized headless render (thumbnail/PDF/test). Relax the CSP so a private
  // artifact that loads Tailwind Play CDN etc. renders styled in its own thumbnail.
  const resp = await serveAsset(request, env, asset, slug, true, { relaxCsp: true });
  return new HTMLRewriter().on('head', {
    element(e: { prepend: (c: string, o: { html: boolean }) => void }) {
      e.prepend(scriptTag, { html: true });
    },
  }).transform(resp);
}

export async function handleServe(
  request: Request,
  env: Env,
  slug: string,
  assetPath: string,
  // contentOrigin: the request arrived on the dedicated content domain
  // (<hex>.shareoutcdn.site). There is no session cookie there, so private artifacts
  // are authorized by the path-prefix capability token (`ct`) instead of checkAccess,
  // and private bytes are served `no-store` (ADR 30).
  // executionCtx: threaded so the viewers can register per-view analytics writes with
  // waitUntil() instead of firing them detached (which the runtime may cancel).
  opts: { contentOrigin?: boolean; ct?: string | null; executionCtx?: ExecutionContext } = {},
): Promise<Response> {
  const url = new URL(request.url);
  const isRawRequest = url.searchParams.has('_raw');
  const captureToken = url.searchParams.get('_capture');
  const contentOrigin = opts.contentOrigin === true;

  // Check for version override (?v=mobile or ?v=web)
  const versionOverride = url.searchParams.get('v');
  const forceMobile = versionOverride === 'mobile';
  const forceWeb = versionOverride === 'web';

  // Try KV cache first for deployment info (if available)
  let cached = await getCachedDeployment(env, slug);
  // Legacy cache entries (written before the record was fattened) lack the new
  // immutable fields — treat them as a miss so they get re-fetched and re-cached in
  // the new shape. Drains within one TTL after deploy.
  if (cached && !('entry_asset' in cached)) cached = null;

  // Combined query: artifact info + asset in single round-trip
  const targetPath = assetPath || null;
  let result: ArtifactWithAsset | null = null;
  // Mobile entrypoint asset, carried forward so the mobile branch below needs no
  // per-view query: from the cache on a hit, freshly fetched on a miss.
  let mobileEntryAsset: { r2_key: string; mime: string; size_bytes: number } | null = null;

  if (cached) {
    mobileEntryAsset = cached.mobile_entry_asset;
    const entry = targetPath === null ? cached.entry_asset : null;
    if (entry) {
      // Hot path: entrypoint view — the asset row rides the cache, no D1 query.
      result = { ...cached, r2_key: entry.r2_key, mime: entry.mime, size_bytes: entry.size_bytes };
    } else {
      // Sub-asset request (or an entrypoint with no cached asset): fetch its row.
      const asset = await fetchAssetRow(env, cached.version_id, targetPath || cached.entrypoint);
      result = {
        ...cached,
        r2_key: asset?.r2_key || null,
        mime: asset?.mime || null,
        size_bytes: asset?.size_bytes || null,
      };
    }
  } else {
    // Cache miss: full combined query (+ access_policy + manifest_json, immutable per version)
    result = await env.DB.prepare(`
      SELECT d.version_id, v.entrypoint, v.mobile_entrypoint, v.artifact_id, v.manifest_json,
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
        AND ast.path = COALESCE(?, v.entrypoint)
      WHERE d.slug = ? AND d.channel = 'production'
    `).bind(targetPath, slug).first<ArtifactWithAsset>();

    // Cache the deployment info (with entrypoint asset rows) for next time.
    if (result) {
      // When this miss is the entrypoint request the combined query already returned
      // the web entry asset; otherwise fetch it. Mobile entry only when present.
      const webEntryAsset = targetPath === null
        ? (result.r2_key && result.mime && result.size_bytes
            ? { r2_key: result.r2_key, mime: result.mime, size_bytes: result.size_bytes }
            : null)
        : await fetchAssetRow(env, result.version_id, result.entrypoint);
      mobileEntryAsset = result.has_mobile && result.mobile_entrypoint
        ? await fetchAssetRow(env, result.version_id, result.mobile_entrypoint)
        : null;

      await cacheDeployment(env, slug, buildCacheRecord(result, webEntryAsset, mobileEntryAsset));
    }
  }

  if (!result) {
    return new Response('Not Found', { status: 404 });
  }

  // Paused / blocked pages must not leak the artifact title to strangers. Generic
  // copy only — name was previously embedded in the HTML before the access gate.
  if (result.paused === 1) {
    return pausedPage();
  }

  // Moderation gate (Workstream B). A blocked artifact shows a takedown page to
  // everyone, including the owner. 'pending' artifacts are forced private at
  // publish, so non-owners are already gated by the visibility check below and the
  // owner may still preview their own under-review artifact — no extra gate here.
  if ((result.moderation_status ?? 'approved') === 'blocked') {
    return takedownPage();
  }

  // Capture mode short-circuit: a signed capture token authorizes the renderer to
  // get the bare, un-sandboxed HTML at top-level. Bypasses the login gate (the
  // token is the capability) and the iframe wrapper.
  if (captureToken && !assetPath && result.mime === 'text/html') {
    const payload = await verifyAccessToken(captureToken, result.artifact_id, env);
    // Capture tokens authorize a headless render. 'capture' is the token every render
    // mints now; 'capture_test' is still accepted for any in-flight tokens minted by
    // the previous deploy. Both resolve to the same read-only render — serveCaptureView
    // always injects a read-only `owner_test` session (no capture render ever writes).
    // 'capture_verify' is a writable capture: the crew pilot_verify flow drives the
    // real UI and must persist (form submits). All other capture types stay read-only.
    if (
      !payload ||
      (payload.authType !== 'capture' &&
        payload.authType !== 'capture_test' &&
        payload.authType !== 'capture_verify')
    ) {
      return new Response('Forbidden', { status: 403 });
    }
    const writableCapture = payload.authType === 'capture_verify';
    // Version-pinned capture: the renderer can pin a specific version (?_ver=) so
    // Artifact Tests can render a CANDIDATE version that isn't the live deployment
    // (BLOCK-mode gating). Capability is the capture token; the version must belong
    // to this artifact. Without _ver, capture the live deployment's entrypoint.
    const verPin = url.searchParams.get('_ver');
    let captureAsset: { r2_key: string; mime: string; size_bytes: number } | null =
      result.r2_key && result.size_bytes ? { r2_key: result.r2_key, mime: result.mime, size_bytes: result.size_bytes } : null;
    if (verPin && verPin !== result.version_id) {
      captureAsset = await env.DB.prepare(`
        SELECT ast.r2_key, ast.mime, ast.size_bytes
        FROM versions v JOIN assets ast ON ast.version_id = v.id AND ast.path = v.entrypoint
        WHERE v.id = ? AND v.artifact_id = ?
      `).bind(verPin, result.artifact_id).first<{ r2_key: string; mime: string; size_bytes: number }>();
    }
    if (!captureAsset || captureAsset.mime !== 'text/html') {
      return new Response('Not Found', { status: 404 });
    }
    return serveCaptureView(
      request, env, captureAsset, slug, result, env.SHAREOUT_BASE_URL.replace(/\/$/, ''), writableCapture,
    );
  }

  const visibility = normalizeVisibility(result.visibility) || 'public';
  // Only explicitly open artifacts skip the content-domain capability gate. Everything
  // else — private, the legacy 'workspace' value, and any unknown future value — is
  // treated as protected (fail-closed), so the content domain never leaks gated bytes.
  const isOpen = visibility === 'public';

  if (contentOrigin) {
    // On the content domain there is no session cookie. The trusted shell already
    // gated access before embedding the iframe, and minted a short-lived, artifact-
    // scoped capability token. Verify it (and its dedicated authType so a content
    // token can never double as a data-API credential — see checkDataAuth).
    if (!isOpen) {
      const payload = opts.ct ? await verifyAccessToken(opts.ct, result.artifact_id, env) : null;
      if (!payload || payload.authType !== 'content') {
        return new Response('Forbidden', { status: 403 });
      }
    }
  } else if (visibility === 'private' || visibility === 'workspace') {
    // Private/workspace is closed: no social-crawler OG bypass (that used to serve
    // title/description/thumbnail to Googlebot, Slackbot, etc. without auth). Unauthorized
    // callers get a generic login/denied gate with no artifact metadata.
    const accessResult = await checkAccess(request, env, slug, result);
    if (accessResult) {
      // Held-from-public page: the publish was public but the safety check forced it
      // private (moderation_held_visibility set). An anon/unauthorized visitor gets a
      // truthful "being reviewed" page instead of a login wall they can't clear. The
      // owner passed checkAccess above (accessResult null), so they still see the page.
      if ((result.moderation_status ?? 'approved') === 'pending' && result.moderation_held_visibility) {
        return underReviewPage();
      }
      return accessResult;
    }
  }

  // Gated bytes on the content domain must never enter a shared cache.
  const noStore = contentOrigin && !isOpen;

  // Determine which entrypoint to use based on device detection
  const useMobile = !forceWeb && result.has_mobile && result.mobile_entrypoint &&
    (forceMobile || isMobileDevice(request));
  const effectiveEntrypoint = useMobile ? result.mobile_entrypoint! : result.entrypoint;
  const resolvedPath = assetPath || effectiveEntrypoint;

  // Asset found in combined query - but we may need to fetch mobile asset instead
  let asset: { r2_key: string; mime: string; size_bytes: number } | null = null;

  if (result.r2_key && result.mime && result.size_bytes && !useMobile) {
    // Use the already-fetched asset (web version)
    asset = { r2_key: result.r2_key, mime: result.mime, size_bytes: result.size_bytes };
  } else if (useMobile && !assetPath) {
    // Mobile entrypoint asset — rode the cache, or was fetched on the miss above.
    asset = mobileEntryAsset;
  } else if (result.r2_key && result.mime && result.size_bytes) {
    asset = { r2_key: result.r2_key, mime: result.mime, size_bytes: result.size_bytes };
  }

  const baseUrl = env.SHAREOUT_BASE_URL.replace(/\/$/, '');
  const socialPreview = resolveArtifactSocialPreview(result, baseUrl, slug);

  if (asset) {
    // Check for type-specific viewer (CSV, Markdown, JSON, TXT)
    const artifactType = result.artifact_type || 'html';
    if (!assetPath && !isRawRequest && hasCustomViewer(artifactType)) {
      return serveTypeViewer(request, env, result, asset, slug, socialPreview, opts.executionCtx);
    }

    if (asset.mime === 'text/html' && !assetPath && !isRawRequest) {
      return serveSandboxedViewer(
        request,
        env,
        slug,
        effectiveEntrypoint,
        result.version_id,
        result.artifact_id,
        result.pwa_config,
        visibility,
        result.access_policy,
        result.manifest_json,
        result.owner_id,
        result.workspace_id,
        socialPreview,
        opts.executionCtx,
      );
    }

    // Raw artifact HTML (the iframe entrypoint on the content domain — the product's
    // hottest path). Edge-cache it keyed by the immutable r2_key with a comments-
    // overlay variant, so repeat public views skip the R2 read + HTMLRewriter pass.
    // The comments agent injection (Phase 2: anchor pinned comments) is threaded in as
    // the body transform so the cached entry is the final, post-injection HTML. Gated
    // (private) bytes stay no-store and are never cached. (007)
    if (isRawRequest && asset.mime === 'text/html') {
      const commentsEnabled = await isCommentsOverlayEnabled(env, result.artifact_id);
      const artifactId = result.artifact_id;
      // "Made with ShareOut" badge (Workstream C): opt-in per instance via
      // ARTIFACT_BADGE=1. It used to be forced on for the free tier, which on a
      // self-hosted instance — where every account reads as free — stamped an
      // unremovable watermark on every public page. The badge state still rides
      // the cache variant so badged and unbadged HTML never mix.
      const showBadge = isOpen && badgeEnabled(env);
      // The perf beacon (opt-017) is unconditional, so it rides every cache variant
      // without adding a key. Comments + badge injection chain after it when enabled.
      // Capture-mode renders never reach this raw path, so they self-exclude.
      const variant = `${commentsEnabled ? 'cmt' : 'raw'}${showBadge ? '-b' : ''}`;
      return serveAsset(request, env, asset, slug, isRawRequest, {
        noStore,
        relaxCsp: !isOpen,
        cacheHtml: true,
        cacheVariant: variant,
        transform: (resp) => {
          let out = injectPerfBeacon(resp, artifactId, baseUrl);
          out = injectPresenceBeacon(out, artifactId, baseUrl);
          if (commentsEnabled) out = injectCommentsAgent(out, baseUrl);
          if (showBadge) out = injectBadge(out, artifactId, baseUrl);
          return out;
        },
      });
    }

    return serveAsset(request, env, asset, slug, isRawRequest, { noStore, relaxCsp: !isOpen });
  }

  // Fallback: try index.html if no asset found and not already looking for it
  if (!assetPath && resolvedPath !== 'index.html') {
    const indexAsset = await env.DB.prepare(`
      SELECT r2_key, mime, size_bytes FROM assets
      WHERE version_id = ? AND path = 'index.html'
    `).bind(result.version_id).first<{ r2_key: string; mime: string; size_bytes: number }>();

    if (indexAsset) {
      return serveAsset(request, env, indexAsset, slug, isRawRequest, { noStore, relaxCsp: !isOpen });
    }
  }

  return notFound();
}