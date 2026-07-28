import type { Env } from '../../types';
import { trackPageView } from '../../analytics';
import { trackViewerView } from '../../view-tracking';
import { getSessionUser } from '../../auth';
import { maybeEmitViewEvent } from '../../scheduling/events';
import { createAccessToken } from '../../token';
import {
  SANDBOX_PERMISSIONS,
  getSecurityHeaders,
  artifactContentUrl,
  artifactContentHost,
} from '../security';
import { escapeHtml, runBackground, NOINDEX_ROBOTS } from '../utils';
import { normalizeVisibility } from '../../visibility-config';
import {
  fetchInitialJsonData,
  fetchInitialTableData,
  detectAdminStatus,
  detectFavoriteState,
  detectCommentsState,
  fetchAttachedSkills,
} from '../prefetch';
import { hasMetricDefinitions } from '../../metric-alerts/definitions';
import { renderSocialMetaTags, type SocialPreview } from '../social-meta';
import { resolvePwa } from './pwa-tags';
import { renderEarlyHead } from './early-head';
import { resolveManifestPreload, renderInlinedStyleBlock } from './manifest-preload';
import { buildInitialViewerData } from './initial-data';
import {
  renderBridgeScript,
  renderEarlyCdnBridgeHook,
  renderDeferredBridgeDelivery,
} from './bridge-script';
import { renderLoadingHideScript } from './loading';
import { buildToolbarContext } from './toolbar/context';
import { renderToolbar } from './toolbar';
import { getViewerConfig } from '../../data/viewer-config';
import { isVisualEditorEnabled } from '../../editor/visual-editor-gate';

/**
 * Stream a sandboxed HTML wrapper around an artifact iframe.
 *
 * The wrapper is responsible for:
 * - Social / PWA meta tags in the streamed head
 * - Critical asset preloading and optional CSS inlining
 * - Injecting initial JSON/table data and a per-viewer session token
 * - Hosting the floating toolbar (favorites, comments, admin) outside the sandbox
 */
export async function serveSandboxedViewer(
  request: Request,
  env: Env,
  slug: string,
  entrypoint: string,
  versionId: string,
  artifactId: string,
  pwaConfigJson: string | null,
  visibility: string,
  // Per-version immutables threaded from the serve path / deployment cache so the
  // viewer needs no per-view D1 query for them.
  accessPolicy: string | null,
  manifestJson: string | null,
  ownerId: string | null,
  workspaceId: string | null,
  socialPreview?: SocialPreview,
  // Threaded from the serve path so per-view analytics writes run via waitUntil
  // instead of detached (which the runtime may cancel at response end).
  executionCtx?: ExecutionContext,
): Promise<Response> {
  const baseUrl = env.SHAREOUT_BASE_URL.replace(/\/$/, '');
  // The home Studio loads the artifact in an iframe with ?wsx=1; the Studio's right
  // rail already provides share/comments/details, so suppress the in-artifact toolbar.
  const studioEmbed = new URL(request.url).searchParams.has('wsx');

  // The untrusted artifact loads cross-origin from its per-artifact content host
  // (<hex>.shareoutcdn.site) once the cutover is live; pre-flip it stays same-origin.
  // Gated artifacts carry a short-lived, artifact-scoped capability token in the path
  // (/c/<ct>/) — access was already enforced upstream, and the content domain has no
  // session cookie. ~45 min TTL survives lazy imports / reload. Fail-closed: anything
  // not explicitly public (private, legacy 'workspace', unknown) gets a token.
  const contentHost = artifactContentHost(env, artifactId, request);
  const isOpen = normalizeVisibility(visibility) === 'public';
  const ct = contentHost && !isOpen
    ? await createAccessToken(artifactId, 'content', env, 45 * 60)
    : undefined;
  const rawUrl = artifactContentUrl(env, artifactId, slug, entrypoint, ct, request);
  const encoder = new TextEncoder();

  const { config: pwaConfig, tags: pwaTags } = resolvePwa(pwaConfigJson, baseUrl, slug);

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  const pageTitle = escapeHtml(socialPreview?.title || slug);
  const socialTags = socialPreview ? renderSocialMetaTags(socialPreview) : '';

  const iframeHtml = `<iframe
    src="${escapeHtml(rawUrl)}"
    sandbox="${SANDBOX_PERMISSIONS}"
    allow="clipboard-write"
    loading="eager"
  ></iframe>`;

  // On the content domain the artifact loads cross-origin (its own subresources,
  // inlined CSS, and same-origin ?_raw preloads can't be warmed from this parent
  // document), so the only useful head hint is a preconnect — emitted in the very
  // first streamed byte. The iframe is then emitted immediately after, before the
  // per-view prefetch below, so its load starts in parallel with those queries
  // instead of waiting for the slowest of them. In legacy same-origin (dev) mode
  // the preload links still help, so the iframe stays after them (old behavior).
  writer.write(encoder.encode(
    renderEarlyHead(pageTitle, socialTags, pwaTags, contentHost || undefined, !isOpen),
  ));
  if (contentHost) {
    // Bridge hook must land before prefetch so shareout:init can fire as soon as
    // the viewer session is ready — the iframe starts loading in parallel above.
    writer.write(encoder.encode(`  ${iframeHtml}\n  ${renderEarlyCdnBridgeHook()}\n`));
  }

  // Resolve the viewer's session once per request (was resolved 5× before) and
  // share the promise with the streamed body and the tracking tail below.
  const sessionUserPromise = getSessionUser(request, env);

  (async () => {
    try {
      const hasAccessPolicy = !!accessPolicy;
      const user = await sessionUserPromise;

      const [initialJsonData, initialTableData, adminInfo, favInfo, commentsInfo, hasMetrics, viewerConfig, visualEditorEnabled, attachedSkills, profile] = await Promise.all([
        hasAccessPolicy ? null : fetchInitialJsonData(env, artifactId),
        hasAccessPolicy ? null : fetchInitialTableData(env, artifactId),
        detectAdminStatus(user, env, artifactId, ownerId),
        detectFavoriteState(user, env, artifactId),
        detectCommentsState(user, env, artifactId),
        // Only logged-in viewers can follow a metric, so skip the lookup for anonymous views.
        user ? hasMetricDefinitions(env, artifactId) : false,
        getViewerConfig(env, artifactId),
        isVisualEditorEnabled(env, workspaceId, user?.email),
        fetchAttachedSkills(user, env, artifactId),
        // Folded into the batch so the viewer's profile no longer adds a
        // sequential D1 round-trip after this Promise.all resolves.
        user
          ? env.DB.prepare('SELECT name, picture FROM users WHERE id = ?')
              .bind(user.id)
              .first<{ name: string | null; picture: string | null }>()
          : null,
      ]);

      // Cross-origin (cdn) viewers can't use the parent's preload cache or inlined
      // CSS, so skip the manifest preload's KV/D1/R2 reads entirely; the preconnect
      // in the early head is the only useful hint. Legacy same-origin keeps them.
      let headLinks = '';
      let inlinedStyleBlock = '';
      if (!contentHost) {
        const { inlinedCSS, preloadLinks } = await resolveManifestPreload(
          env,
          versionId,
          slug,
          baseUrl,
          manifestJson,
        );
        headLinks = preloadLinks;
        inlinedStyleBlock = renderInlinedStyleBlock(inlinedCSS);
      }

      const {
        serialized: serializedInitialData,
        scriptTag: initialDataScript,
        currentUser,
      } = await buildInitialViewerData(
        user,
        env,
        artifactId,
        baseUrl,
        initialJsonData,
        initialTableData,
        adminInfo,
        profile,
      );

      const bridgeScript = contentHost
        ? renderDeferredBridgeDelivery(serializedInitialData)
        : renderBridgeScript(serializedInitialData, pwaConfig, baseUrl);
      const mobileSdkScript = contentHost && pwaConfig?.enabled
        ? `<script src="${baseUrl}/sdk/v1/shareout-mobile.js"></script>\n  `
        : '';

      const toolbarContext = buildToolbarContext({
        loggedIn: favInfo.loggedIn,
        isFav: favInfo.isFavorite,
        commentsEnabled: commentsInfo.enabled,
        commentsIdentityMode: commentsInfo.identityMode,
        commentCount: commentsInfo.count,
        hasMetrics,
        adminInfo,
        currentUser,
        hideToolbar: viewerConfig.hide_toolbar || studioEmbed,
        baseUrl,
        slug,
        artifactId,
        visualEditorEnabled,
        attachedSkills,
      });
      const toolbar = toolbarContext ? renderToolbar(toolbarContext) : '';
      const bodyClass = viewerConfig.hide_toolbar
        ? ''
        : viewerConfig.show_on_mobile
          ? 'so-show-toolbar-mobile'
          : 'so-hide-toolbar-mobile';

      // <head> and <body> were already opened (and the loading skeleton painted)
      // in the streamed early head, so this chunk continues inside <body>. The
      // deferred head bits (preload links, inlined CSS, init data + bridge
      // scripts) are valid in body; the toolbar-visibility class is applied via a
      // small script since <body> opened before viewerConfig was known. In cdn
      // mode the iframe was already streamed above; in legacy mode it goes here
      // (after the preload links so they still warm the same-origin subresources).
      const bodyClassScript = bodyClass
        ? `<script>document.body.className=${JSON.stringify(bodyClass)}</script>`
        : '';

      const restOfHtml = `${headLinks ? '  ' + headLinks + '\n' : ''}  ${inlinedStyleBlock}${initialDataScript}${mobileSdkScript}${bridgeScript}${bodyClassScript}${contentHost ? '' : '\n  ' + iframeHtml}${toolbar}
  ${renderLoadingHideScript()}
</body>
</html>`;

      await writer.write(encoder.encode(restOfHtml));
    } catch {
      // In cdn mode the iframe is already in the stream; only legacy needs the
      // fallback iframe so a prefetch failure still renders the artifact.
      const fallbackBody = `${contentHost ? '' : '  ' + iframeHtml + '\n'}  ${renderLoadingHideScript()}
</body>
</html>`;
      await writer.write(encoder.encode(fallbackBody));
    } finally {
      await writer.close();
    }
  })();

  // Per-view side effects: registered with waitUntil (via runBackground) so they
  // survive response completion instead of being cancelled as detached promises.
  runBackground(executionCtx, trackPageView(env, request, artifactId, entrypoint));
  runBackground(executionCtx, maybeEmitViewEvent(env, artifactId, request));
  runBackground(executionCtx, sessionUserPromise.then(user => {
    if (user) {
      return trackViewerView(env, artifactId, user.email, entrypoint, user.id === ownerId);
    }
  }));

  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // This wrapper embeds a short-lived, per-viewer Bearer sessionToken (the
      // sandboxed opaque-origin iframe can't send the session cookie, so data/agent
      // calls authenticate with this token). It must never be stored by shared or
      // browser caches — a re-served copy carries a stale/expired token and every
      // in-artifact data call then 401s. Keep it uncacheable.
      'Cache-Control': 'private, no-store, must-revalidate',
      'Transfer-Encoding': 'chunked',
      ...getSecurityHeaders(false, env),
      // Closed content stays out of search indexes even for authorized sessions.
      ...(!isOpen ? { 'X-Robots-Tag': NOINDEX_ROBOTS } : {}),
    },
  });
}
