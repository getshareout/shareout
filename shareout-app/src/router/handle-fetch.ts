import type { Env } from '../types';
import { handleDataRequest } from '../data/router';
import { handleFileContent, handleFileMeta } from '../data/files-content';
import { handleCORS } from '../cors';
import { parseSubdomainFromEnv, resolveSubdomainRoute } from '../subdomain';
import { getCdnRegistrable } from '../config/origins';
import { handleCdnContent } from './cdn-content';
import { createFetchContext, type FetchContext } from './context';
import { routeAuth } from './auth-router';
import { routeApi } from './api-router';
import { routeServe } from './serve-router';
import { routeTelegram } from './telegram-router';
import { handleAbuseReport } from '../moderation/abuse-reports';
import { routeSlack } from './slack-router';
import { routeInternalAdmin } from './internal-admin';
import { routeEmail } from '../email/routes';
import { renderNotFoundPage } from '../pages/not-found';
import { blockDisabledMarketingPages } from '../marketing-us-gate';

// HTML document navigations get the styled 404 page; API/data/asset requests keep
// the lightweight plain-text body so non-browser clients aren't handed markup.
function notFound(request: Request, path: string): Response {
  const accept = request.headers.get('Accept') || '';
  const wantsHtml = request.method === 'GET' && accept.includes('text/html') && !path.startsWith('/v1/');
  return wantsHtml ? renderNotFoundPage() : new Response('Not Found', { status: 404 });
}

// Re-point a context at a rewritten path while preserving method, query, headers,
// and body, so the shared apex pipeline handles a subdomain shorthand URL.
function rewriteContextPath(ctx: FetchContext, newPath: string): FetchContext {
  const url = new URL(ctx.url.toString());
  url.pathname = newPath;
  const request = new Request(url.toString(), ctx.request);
  return { ...ctx, request, url, path: url.pathname };
}

// Optional docs host: when DOCS_HOST + DOCS_ORIGIN are both set, requests to that
// hostname are proxied to wherever the built `docs-site/` lives instead of being
// treated as a workspace subdomain. Unset (default) = no docs proxying.
async function proxyDocs(request: Request, docsOrigin: string): Promise<Response> {
  const target = new URL(request.url);
  target.hostname = docsOrigin;
  target.protocol = 'https:';
  target.port = '';
  return fetch(new Request(target.toString(), request));
}

// Optional separate marketing site. The worker stays the front door: product paths
// (app, api, auth, serve) match first; anything unclaimed on the apex is proxied to
// MARKETING_ORIGIN when set. Unset (self-host default) = no marketing site.
async function proxyMarketing(request: Request, marketingOrigin: string): Promise<Response> {
  const incoming = new URL(request.url);
  let pathname = incoming.pathname;
  // Astro directory builds expect a trailing slash; without it Pages 308s and some
  // subrequests (including Google's policy fetcher) never get HTML.
  if (pathname !== '/' && !pathname.endsWith('/') && !pathname.includes('.')) {
    pathname += '/';
  }
  const target = `https://${marketingOrigin}${pathname}${incoming.search}`;
  const upstream = await fetch(target, {
    method: 'GET',
    headers: { Accept: request.headers.get('Accept') ?? 'text/html,*/*' },
  });
  const location = upstream.headers.get('Location');
  if (upstream.status >= 300 && upstream.status < 400 && location?.startsWith('/')) {
    return Response.redirect(new URL(location, incoming.origin).toString(), upstream.status);
  }
  return upstream;
}

// Product/control namespaces the worker owns. An unmatched request under one of
// these gets the worker's own 404 (API clients expect that, not marketing HTML).
// Everything else on the apex — site pages and the marketing build's own assets
// (/_astro, /brand/*, /artifacts) — falls through to the marketing Pages site.
const RESERVED_PREFIXES = [
  '/v1/', '/api/', '/auth/', '/sdk/', '/admin', '/superadmin', '/editor',
  '/internal/', '/telegram/', '/slack/', '/report/', '/debug', '/health',
  '/app', '/home', '/create', '/teams', '/settings/', '/workspace', '/share-target',
  '/manifest.webmanifest', '/sw.js',
  '/a/', '/@', '/p/', '/embed/', '/t/', '/wl/',
];

function isReservedProductPath(path: string): boolean {
  return RESERVED_PREFIXES.some((p) =>
    p.endsWith('/') ? path.startsWith(p) : path === p || path.startsWith(`${p}/`)
  );
}

export async function handleFetch(request: Request, env: Env, executionCtx?: ExecutionContext): Promise<Response> {
  let ctx = createFetchContext(request, env, executionCtx);

  if (env.DOCS_HOST && env.DOCS_ORIGIN && ctx.hostname === env.DOCS_HOST) {
    return proxyDocs(ctx.request, env.DOCS_ORIGIN);
  }

  // Dedicated untrusted-content domain (ADR 30): a locked-down parallel dispatcher
  // that serves only raw artifact bytes and never enters the shared app pipeline
  // (no auth, app, admin, data API, or session cookies).
  const cdnHost = getCdnRegistrable(env);
  if (cdnHost && (ctx.hostname === cdnHost || ctx.hostname.endsWith(`.${cdnHost}`))) {
    return handleCdnContent(ctx.request, env, executionCtx);
  }

  const subCtx = parseSubdomainFromEnv(ctx.hostname, env);
  if (subCtx.isSubdomain && subCtx.workspaceSlug) {
    const route = await resolveSubdomainRoute(ctx.request, env, subCtx.workspaceSlug, ctx.path);
    if (route.response) return route.response;
    if (route.rewritePath) ctx = rewriteContextPath(ctx, route.rewritePath);
    // Otherwise fall through to the shared pipeline unchanged.
  }

  const { request: req, path } = ctx;

  // Worker-to-worker admin bridge (shared Bearer secret). Before auth/app pipeline.
  if (path.startsWith('/internal/admin/')) {
    return (await routeInternalAdmin(req, env, path)) ?? new Response('Not Found', { status: 404 });
  }

  if (path.startsWith('/v1/data/')) {
    const waitUntil = executionCtx ? executionCtx.waitUntil.bind(executionCtx) : undefined;
    return handleDataRequest(req, env, path.slice('/v1/data'.length), waitUntil);
  }

  // File content by deliverable id (work/042 P3): /v1/files/{dlv}/content — the
  // deliverable-keyed, identity-checked front door for Files (byte-level deny for
  // private files; embeddable workspace files).
  {
    const m = path.match(/^\/v1\/files\/([^/]+)\/content$/);
    if (m) return handleFileContent(req, env, decodeURIComponent(m[1]));
    const mm = path.match(/^\/v1\/files\/([^/]+)$/);
    if (mm) return handleFileMeta(req, env, decodeURIComponent(mm[1]));
  }

  // Telegram bot webhook + account linking. No session/CSRF — the webhook
  // authenticates via a shared secret header (see telegram-router).
  if (path.startsWith('/telegram/')) {
    return (await routeTelegram(ctx)) ?? new Response('Not Found', { status: 404 });
  }

  // Slack Events API, slash commands, and interactivity (signing-secret auth).
  if (path.startsWith('/slack/')) {
    return (await routeSlack(ctx)) ?? new Response('Not Found', { status: 404 });
  }

  // Email platform: delivery-event webhook (suppressions), one-click unsubscribe,
  // and the session-gated preference center. Before the app pipeline.
  if (path.startsWith('/v1/email/') || path === '/v1/webhooks/email-events') {
    const res = await routeEmail(ctx);
    if (res) return res;
  }

  // Public abuse-report page (Workstream D): the "Report" link on public artifacts.
  // Anonymous, per-IP rate limited; no session/CSRF.
  if (path.startsWith('/report/')) {
    const artifactId = path.slice('/report/'.length).split('/')[0];
    if (artifactId) return handleAbuseReport(req, env, artifactId);
  }

  if (req.method === 'OPTIONS') {
    return handleCORS(req, env);
  }

  return (
    (await routeAuth(ctx)) ??
    (await routeApi(ctx)) ??
    (await routeServe(ctx)) ??
    // Unclaimed apex GET → the separate marketing site when one is configured.
    // Subdomains, non-GET requests, and reserved product/API namespaces keep the
    // worker's own 404. No MARKETING_ORIGIN (self-host default): `/` goes to login,
    // everything else unclaimed falls through to the worker's 404.
    ((req.method === 'GET' && !subCtx.isSubdomain && !isReservedProductPath(path))
      ? (env.MARKETING_ORIGIN
          ? (blockDisabledMarketingPages(env, ctx.hostname, path) ?? await proxyMarketing(req, env.MARKETING_ORIGIN))
          : (path === '/' || path === ''
              ? Response.redirect(new URL('/auth/login', ctx.url.origin).toString(), 302)
              : null))
      : null) ??
    notFound(req, path)
  );
}
