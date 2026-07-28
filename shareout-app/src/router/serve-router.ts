import { handleServe, handleServeText, handleServeNamespaced, handleServeEmbed } from '../serve';
import { canViewClosedArtifact } from '../serve/access';
import { handleDownloadPage, handleDeliveryFile } from '../serve/download-page';
import type { ArtifactInfo } from '../serve/types';
import { handleAdminPage } from '../admin';
import { handleSuperAdminPage } from '../superadmin/page';
import { handleEditor, serveEditorPage } from '../editor/index';
import { handleManifest, handleServiceWorker, handlePWAIcon, handlePWAScreenshot } from '../pwa';
import { renderCreatePage } from '../pages/create';
import { renderTeamsPreviewPage } from '../pages/teams-preview';
import { serveSitemap, serveProductSitemap, serveLlmsTxt, serveRobots, serveIndexNowKey, INDEXNOW_KEY } from '../pages/seo';
import {
  serveAgentSkillMd,
  serveAgentSkillsIndex,
  serveIntegrationsJson,
  serveOpenApiJson,
} from '../pages/integrations-discovery';
import { handleUserHomePage } from '../pages/home';
import { handleSharedPortal } from '../sharees/portal-page';
import { handleInviteAcceptPage, handleInviteJoinPage } from '../workspaces/invite-accept-page';
import { renderTelegramConnectPage, telegramDeepLinkRedirect } from '../pages/telegram-connect';
import { handleSlackConnectPost, renderSlackConnectPage } from '../pages/slack-connect';
import { renderRunsPage } from '../pages/runs';
import { renderSlidesAnalyticsPage } from '../pages/slides-analytics';
import { renderPrivacyPage, renderTermsPage } from '../pages/company';
import { needsSetup, renderSetupPage } from '../pages/setup';
import { renderStatusPage } from '../pages/status';
import { renderWorkspaceIndexPage } from '../pages/workspace';
import { renderWorkspaceUsagePage } from '../pages/workspace-usage';
import { getSessionUser } from '../auth';
import { parseSubdomainFromEnv } from '../subdomain';
import type { FetchContext } from './context';
import { getTokenOrSessionUser } from './helpers/auth-guard';
import { resolveSlugEditorAccess } from './helpers/editor-access';
import { isSourceEditable, serveSourceEditorPage } from '../editor/source/index';
import { isVisualEditorRoute, requireVisualEditorEnabled, visualEditorDisabledPage } from '../editor/visual-editor-gate';
import { getPlatformHostname, getPlatformOrigin } from '../config/origins';
import { isCreateEnabled, createDisabledPage } from '../pages/create-gate';
import { blockDisabledMarketingPages, blockUsMarketingHomepage } from '../marketing-us-gate';
import { hostWorkspaceId } from '../pages/home/host';
import { parseNamespacedPath } from './helpers/parse-namespaced-path';
import { handleBrandAsset, handleRootBrandAsset } from '../brand';
import { serveSharedBundle } from './shared-bundles';
import { handleShareTarget } from '../serve/share-target';
import { normalizeVisibility } from '../visibility-config';
import type { Env } from '../types';

// Edge-cache a stable-keyed R2 image (thumbnails, workspace logos) via the Cache API.
// Unlike version-addressed artifact assets, these R2 keys are reused when the entity's
// image is replaced, so the response keeps its bounded `max-age=86400` — that same TTL
// governs the shared edge cache, so an update reflects within a day rather than being
// pinned forever. Repeat cross-viewer hits skip the R2 read. (007 Stage D)
//
// Private thumbnails: never shared-cache — the edge key is only the r2 path, not the
// session. Serve private, no-store, and skip caches.default entirely.
async function serveCachedR2Image(
  env: Env,
  r2Key: string,
  contentType: string,
  executionCtx?: ExecutionContext,
  fallbackKey?: string,
  opts?: { private?: boolean },
): Promise<Response> {
  const isPrivate = opts?.private === true;
  const cache = caches.default;
  const cacheKey = new Request(`https://artifact-cache.internal/${encodeURI(r2Key)}`, {
    method: 'GET',
    headers: { Accept: contentType },
  });

  if (!isPrivate) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  }

  // Card-sized variants fall back to the full preview for artifacts last generated
  // before the variant existed, so old grids keep showing a thumbnail.
  const obj = (await env.ARTIFACTS.get(r2Key)) ?? (fallbackKey ? await env.ARTIFACTS.get(fallbackKey) : null);
  if (!obj) {
    return new Response(null, { status: 404 });
  }

  const response = new Response(obj.body, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': isPrivate ? 'private, no-store' : 'public, max-age=86400',
      ...(isPrivate ? { 'X-Robots-Tag': 'noindex, nofollow, noarchive' } : {}),
    },
  });

  if (!isPrivate) {
    const toCache = response.clone();
    if (executionCtx) executionCtx.waitUntil(cache.put(cacheKey, toCache));
    else cache.put(cacheKey, toCache);
  }

  return response;
}

export async function routeServe(ctx: FetchContext): Promise<Response | null> {
  const { request, env, path, url, hostname } = ctx;

  // Crawl/agent discovery files — apex marketing host only, not workspace subdomains.
  if (!parseSubdomainFromEnv(hostname, env).isSubdomain) {
    if (path === '/sitemap.xml') return serveSitemap(env);
    if (path === '/sitemap-product.xml') return serveProductSitemap(env);
    if (path === '/llms.txt') return serveLlmsTxt(env);
    if (path === '/robots.txt') return serveRobots(env);
    if (path === '/.well-known/integrations.json') return serveIntegrationsJson(env);
    if (path === '/openapi.json') return serveOpenApiJson(env);
    if (path === '/.well-known/agent-skills/index.json') return serveAgentSkillsIndex(env);
    if (path === '/.well-known/agent-skills/shareout/SKILL.md') return serveAgentSkillMd(env);
  }
  if (path === `/${INDEXNOW_KEY}.txt` && !parseSubdomainFromEnv(hostname, env).isSubdomain) {
    return serveIndexNowKey();
  }

  const rootBrand = await handleRootBrandAsset(path, env);
  if (rootBrand) return rootBrand;

  const brandAsset = await handleBrandAsset(path, env);
  if (brandAsset) return brandAsset;

  const bundle = serveSharedBundle(request, env, path, ctx.executionCtx);
  if (bundle) return bundle;

  if (path === '/manifest.webmanifest' && request.method === 'GET') {
    return env.ASSETS.fetch(new Request(new URL('/manifest.webmanifest', url.origin), request));
  }
  if (path === '/sw.js' && request.method === 'GET') {
    return env.ASSETS.fetch(new Request(new URL('/sw.js', url.origin), request));
  }
  if (path === '/share-target') {
    return handleShareTarget(request, env);
  }

  if ((path === '/admin' || path === '/admin/') && request.method === 'GET') {
    return handleSuperAdminPage(request, env);
  }

  const textMatch = path.match(/^\/a\/([^/]+)\/_text$/);
  if (textMatch && request.method === 'GET') {
    return handleServeText(request, env, textMatch[1]);
  }

  const adminMatch = path.match(/^\/a\/([^/]+)\/admin$/);
  if (adminMatch && request.method === 'GET') {
    return handleAdminPage(request, env, adminMatch[1]);
  }

  if (path.startsWith('/@')) {
    const parsed = parseNamespacedPath(path);
    if (parsed) {
      const { workspaceSlug, folderPath, artifactSlug, assetPath } = parsed;
      return handleServeNamespaced(request, env, workspaceSlug, folderPath, artifactSlug, assetPath, ctx.executionCtx);
    }
  }

  if (path.startsWith('/a/')) {
    const response = await routeArtifactServe(ctx);
    if (response) return response;
  }

  if (path.startsWith('/p/')) {
    const match = path.match(/^\/p\/([^/]+)\/?(.*)$/);
    if (match) {
      const [, slug, assetPath] = match;
      return handleServe(request, env, slug, assetPath, { executionCtx: ctx.executionCtx });
    }
  }

  if (path.startsWith('/d/')) {
    const fileMatch = path.match(/^\/d\/([^/]+)\/file\/([^/]+)\/?$/);
    if (fileMatch) {
      return handleDeliveryFile(fileMatch[1], fileMatch[2], env, request);
    }
    const match = path.match(/^\/d\/([^/]+)\/?$/);
    if (match) {
      return handleDownloadPage(match[1], env, request);
    }
  }

  if (path.startsWith('/embed/')) {
    const match = path.match(/^\/embed\/([^/]+)\/?(.*)$/);
    if (match) {
      const [, slug, assetPath] = match;
      return handleServeEmbed(request, env, slug, assetPath);
    }
  }

  const thumbServeMatch = path.match(/^\/t\/([^.]+)\.(webp|png|jpg)$/);
  if (thumbServeMatch && request.method === 'GET') {
    const [, idSeg, ext] = thumbServeMatch;
    // Card variants use `${artifactId}_card` — resolve the artifact id for access.
    const artifactId = idSeg.endsWith('_card') ? idSeg.slice(0, -'_card'.length) : idSeg;
    const row = await env.DB.prepare(
      'SELECT id, name, visibility, auth_method, owner_id, workspace_id FROM artifacts WHERE id = ?',
    ).bind(artifactId).first<{
      id: string;
      name: string;
      visibility: string;
      auth_method: string | null;
      owner_id: string | null;
      workspace_id: string | null;
    }>();
    // Unknown id → 404 (no oracle). Missing row also covers deleted artifacts.
    if (!row) {
      return new Response(null, { status: 404 });
    }
    const vis = normalizeVisibility(row.visibility) || 'public';
    const closed = vis === 'private' || vis === 'workspace';
    if (closed) {
      // Minimal ArtifactInfo for the access chokepoint — only identity fields matter.
      const info = {
        artifact_id: row.id,
        artifact_name: row.name,
        visibility: row.visibility,
        auth_method: row.auth_method,
        owner_id: row.owner_id,
        workspace_id: row.workspace_id,
      } as ArtifactInfo;
      // 404 not 403 — don't confirm a private thumbnail exists to strangers.
      if (!(await canViewClosedArtifact(request, env, info))) {
        return new Response(null, { status: 404 });
      }
    }
    const r2Key = `thumbnails/${idSeg}.${ext}`;
    const contentType = ext === 'webp' ? 'image/webp' : ext === 'png' ? 'image/png' : 'image/jpeg';
    const fallbackKey = idSeg.endsWith('_card') ? `thumbnails/${idSeg.slice(0, -'_card'.length)}.${ext}` : undefined;
    return serveCachedR2Image(env, r2Key, contentType, ctx.executionCtx, fallbackKey, { private: closed });
  }

  const logoServeMatch = path.match(/^\/wl\/([^.]+)\.(webp|png|jpg|svg)$/);
  if (logoServeMatch && request.method === 'GET') {
    const [, workspaceId, ext] = logoServeMatch;
    const r2Key = `workspace-logos/${workspaceId}.${ext}`;
    const contentType = ext === 'webp' ? 'image/webp'
      : ext === 'png' ? 'image/png'
      : ext === 'svg' ? 'image/svg+xml'
      : 'image/jpeg';
    return serveCachedR2Image(env, r2Key, contentType, ctx.executionCtx);
  }

  if (path === '/setup' || path === '/setup/') {
    if (!(await needsSetup(env))) {
      return Response.redirect(new URL('/home', url.origin).toString(), 302);
    }
    return await renderSetupPage(env);
  }

  if (path === '/home') {
    if (await needsSetup(env)) {
      return Response.redirect(new URL('/setup', url.origin).toString(), 302);
    }
    const sessionUser = await getSessionUser(request, env);
    if (!sessionUser) {
      // Same-origin login so a subdomain visitor returns to the subdomain's /home.
      return Response.redirect(new URL('/auth/login?redirect=/home', url.origin).toString(), 302);
    }
    return handleUserHomePage(request, env, sessionUser);
  }

  // External-sharing spine (work/030) Phase 4: the external member's "shared with me"
  // portal — only the artifacts they were granted, branded by their Sharee.
  if (path === '/shared' && request.method === 'GET') {
    const sessionUser = await getSessionUser(request, env);
    if (!sessionUser) {
      return Response.redirect(new URL('/auth/login?redirect=/shared', url.origin).toString(), 302);
    }
    const portal = await handleSharedPortal(request, env);
    if (portal) return portal;
  }

  // Web invite accept — the human path for a workspace/Sharee invite. Unauth sees a
  // branded join card; signed-in session verifies ownership and drops them into the workspace.
  if (path.startsWith('/invite/') && request.method === 'GET') {
    const code = decodeURIComponent(path.slice('/invite/'.length));
    if (code) {
      const sessionUser = await getSessionUser(request, env);
      if (!sessionUser) {
        return handleInviteJoinPage(request, env, code);
      }
      return handleInviteAcceptPage(request, env, sessionUser, code);
    }
  }

  if (path === '/app/runs' && request.method === 'GET') {
    const sessionUser = await getSessionUser(request, env);
    if (!sessionUser) {
      return Response.redirect(new URL('/auth/login?redirect=' + encodeURIComponent(request.url), url.origin).toString(), 302);
    }
    return renderRunsPage(request, env, sessionUser);
  }

  const slidesAnalyticsMatch = path.match(/^\/app\/slides\/([a-zA-Z0-9_-]+)\/analytics$/);
  if (slidesAnalyticsMatch && request.method === 'GET') {
    const sessionUser = await getSessionUser(request, env);
    if (!sessionUser) {
      return Response.redirect(new URL('/auth/login?redirect=' + encodeURIComponent(request.url), url.origin).toString(), 302);
    }
    return renderSlidesAnalyticsPage(request, env, sessionUser, slidesAnalyticsMatch[1]);
  }

  if (path === '/settings/telegram') {
    const sessionUser = await getSessionUser(request, env);
    if (!sessionUser) {
      return Response.redirect(new URL(`/auth/login?redirect=/settings/telegram${url.search}`, url.origin).toString(), 302);
    }
    if (url.searchParams.get('go')) {
      const redirect = await telegramDeepLinkRedirect(env, sessionUser);
      if (redirect) return redirect;
    }
    return renderTelegramConnectPage(env, sessionUser);
  }

  if (path === '/settings/slack') {
    const sessionUser = await getSessionUser(request, env);
    if (!sessionUser) {
      return Response.redirect(new URL('/auth/login?redirect=/settings/slack', url.origin).toString(), 302);
    }
    if (request.method === 'POST') {
      const form = await request.formData();
      const connection = String(form.get('connection') || '');
      return handleSlackConnectPost(env, sessionUser, connection);
    }
    return renderSlackConnectPage(env, sessionUser);
  }

  const workspaceUsagePath = path.match(/^\/workspace\/([a-z0-9][a-z0-9-]*[a-z0-9]|[a-z0-9])\/usage\/?$/);
  if (workspaceUsagePath) {
    const sessionUser = await getSessionUser(request, env);
    if (!sessionUser) {
      return Response.redirect(new URL('/auth/login?redirect=' + encodeURIComponent(path), url.origin).toString(), 302);
    }
    return renderWorkspaceUsagePage(env, workspaceUsagePath[1], sessionUser.id);
  }

  // Workspaces are never publicly listed on the apex. Bounce to the subdomain root,
  // which gates by membership (showcase workspaces opt into a public gallery there).
  const workspaceSlugPath = path.match(/^\/workspace\/([a-z0-9][a-z0-9-]*[a-z0-9]|[a-z0-9])\/?$/);
  if (workspaceSlugPath) {
    return Response.redirect(`https://${workspaceSlugPath[1]}.${getPlatformHostname(env)}/workspace/`, 302);
  }

  if (path === '/workspace' || path === '/workspace/') {
    const slugParam = url.searchParams.get('slug')?.toLowerCase().trim();
    if (slugParam && /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(slugParam)) {
      return Response.redirect(`https://${slugParam}.${getPlatformHostname(env)}/workspace/`, 302);
    }
    return renderWorkspaceIndexPage(env);
  }

  if (path === '/' || path === '') {
    if (await needsSetup(env)) {
      return Response.redirect(new URL('/setup', url.origin).toString(), 302);
    }
    const blocked = blockUsMarketingHomepage(request, env, hostname, path);
    if (blocked) return blocked;

    const sessionUser = await getSessionUser(request, env);
    if (sessionUser) {
      return new Response(null, { status: 302, headers: { Location: '/home' } });
    }
    const pagesOff = blockDisabledMarketingPages(env, hostname, path);
    if (pagesOff) return pagesOff;
    // Anonymous apex home → fall through to the marketing site (Pages proxy).
    return null;
  }

  if (path === '/create' || path === '/create/') {
    const pagesOff = blockDisabledMarketingPages(env, hostname, path);
    if (pagesOff) return pagesOff;
    const hostWs = await hostWorkspaceId(request, env);
    if (!(await isCreateEnabled(env, hostWs))) {
      const sessionUser = await getSessionUser(request, env);
      return createDisabledPage(sessionUser ? '/home' : '/auth/login?redirect=/home');
    }
    const sessionUser = await getSessionUser(request, env);
    return renderCreatePage(url.searchParams.get('prompt') ?? '', sessionUser, env.TURNSTILE_CLOUDFLARE_SITEKEY, getPlatformHostname(env));
  }

  if (path === '/teams/preview' || path === '/teams/preview/') {
    const pagesOff = blockDisabledMarketingPages(env, hostname, path);
    if (pagesOff) return pagesOff;
    return renderTeamsPreviewPage(url.searchParams.get('name') ?? '', env);
  }

  // Legal pages are served by the worker so OAuth providers (Google Cloud) always
  // get public HTML at a stable URL. Marketing site mirrors the same content.
  if (path === '/privacy' || path === '/privacy/') return renderPrivacyPage(env);
  if (path === '/terms' || path === '/terms/') return renderTermsPage(env);
  // Public platform status (B15) — no auth; self-hosted health_metrics_hourly.
  if (path === '/status' || path === '/status/') {
    return renderStatusPage(env);
  }

  return null;
}

async function routeArtifactServe(ctx: FetchContext): Promise<Response | null> {
  const { request, env, path, url } = ctx;
  const match = path.match(/^\/a\/([^/]+)\/?(.*)$/);
  if (!match) return null;

  const [, slug, assetPath] = match;

  if (assetPath === 'manifest.json') {
    return handleManifest(env, slug);
  }

  if (assetPath === 'sw.js') {
    return handleServiceWorker(env, slug);
  }

  const iconMatch = assetPath.match(/^_pwa\/icon-(\d+)\.png$/);
  if (iconMatch) {
    return handlePWAIcon(env, slug, parseInt(iconMatch[1], 10));
  }

  const screenshotMatch = assetPath.match(/^_pwa\/screenshot-(mobile|desktop)\.png$/);
  if (screenshotMatch) {
    return handlePWAScreenshot(env, slug, screenshotMatch[1] as 'mobile' | 'desktop');
  }

  if (assetPath === 'edit' || assetPath.startsWith('edit/')) {
    return routeEditorServe(ctx, slug, assetPath);
  }

  return handleServe(request, env, slug, assetPath, { executionCtx: ctx.executionCtx });
}

async function routeEditorServe(
  ctx: FetchContext,
  slug: string,
  assetPath: string
): Promise<Response> {
  const { request, env, url } = ctx;

  const user = await getTokenOrSessionUser(ctx);
  if (!user) {
    const loginUrl = new URL(`/auth/login?redirect=/a/${slug}/edit`, url.origin);
    return Response.redirect(loginUrl.toString());
  }

  const access = await resolveSlugEditorAccess(env, slug, user);
  if (!access.ok) return access.response;

  const { artifact, role, editorUser } = access;

  const editorSubPath = assetPath === 'edit' ? '' : assetPath.slice('edit/'.length);
  if (isVisualEditorRoute(editorSubPath)) {
    const disabled = await requireVisualEditorEnabled(env, artifact.workspace_id, user.email);
    if (disabled) {
      if (assetPath === 'edit' && request.method === 'GET') {
        return visualEditorDisabledPage(getPlatformOrigin(env), slug);
      }
      return disabled;
    }
  }

  if (assetPath === 'edit') {
    if (isSourceEditable(artifact.artifact_type)) {
      return serveSourceEditorPage(
        env,
        artifact,
        artifact.artifact_type,
        getPlatformOrigin(env),
      );
    }
    return serveEditorPage(
      request,
      artifact.id,
      slug,
      env,
      artifact.name,
      artifact.description,
      editorUser
    );
  }

  const editorPath = assetPath.slice('edit/'.length);
  return handleEditor(request, {
    artifactId: artifact.id,
    userId: editorUser.userId,
    userName: editorUser.userName,
    userAvatar: editorUser.userAvatar,
    role,
    env,
    waitUntil: ctx.executionCtx?.waitUntil?.bind(ctx.executionCtx),
  }, editorPath);
}
