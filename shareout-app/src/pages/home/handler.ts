/**
 * Main request handler: loads home page data and renders the SSR response.
 */
import type { Env } from '../../types';
import { configuredProviders } from '../../file-imports/oauth';
import { getVisibilityScope, placeholders } from '../../account-links';
import { inboxEmailDomain } from '../../scheduling/email';
import { getPlatformOrigin } from '../../config/origins';
import { isPlatformAdmin } from '../../superadmin/auth';
import { getInternalWorkspaceRole } from '../../workspaces/roles';
import { hostWorkspaceId } from './host';
import { parseHomeFilters } from './filters';
import type { RenderArgs } from './types';
import { buildWorkspaceView } from './render-workspace';
import { homeI18nUrl, homeShellUrls } from './shell-assets';
import { renderHtmlPageStreamed } from '../../design-system/shell';
import type { HtmlPageOptions } from '../../design-system/shell';
import { isFeatureEnabled } from '../../features/flags';
import { CREATE_FEATURE } from '../create-gate';
import { versionedBundlePath } from '../../bundle-versions';
import { createLogger, logError } from '../../logging';
import { getWorkspaceLocale, localeFromAcceptLanguage, resolveLocale, type Locale } from '../../i18n/locale';
import { serverTimingValue, timeSync } from '../../http/request-scope';
import { resolveAllowOpen } from '../../access/allow-open';

/** Head options for the streamed workspace home shell. The page + workspace styles, the
 *  static client script and one locale's copy are cached files (shell-assets), linked from
 *  the head so they download while the body's queries run. The head goes out before the
 *  person's saved language is read, so it preloads the browser language's copy; the body
 *  then loads the copy for the resolved language (usually the same file). */
function homeHead(shell: { js: string; css: string }, i18n: string): Omit<HtmlPageOptions, 'body' | 'scripts'> {
  return {
    title: 'My Artifacts · ShareOut',
    pageStyles: '',
    bodyClass: 'so-theme-glass',
    cacheControl: 'private, no-cache',
    extraHead: '<link rel="manifest" href="/manifest.webmanifest">'
      + `<link rel="stylesheet" href="${shell.css}">`
      + `<link rel="preload" as="script" href="${i18n}">`
      + `<link rel="preload" as="script" href="${shell.js}">`,
  };
}

export async function handleUserHomePage(
  request: Request,
  env: Env,
  user: { id: string; email: string | null }
): Promise<Response> {
  const filters = parseHomeFilters(new URL(request.url));

  // Stream the shell at first byte, then run the body's reads and stream the real
  // body in underneath. First paint doesn't block on them (nor on the host lookup:
  // the head does not depend on it).
  const homeLogger = createLogger(env, { scope: 'home.stream' });
  const shell = await homeShellUrls();
  const browserLocale = localeFromAcceptLanguage(request.headers.get('Accept-Language')) ?? 'en';
  return renderHtmlPageStreamed({
    ...homeHead(shell, await homeI18nUrl(browserLocale)),
    earlyBody: '',
    body: () => buildHomeBody(request, env, user, filters, browserLocale),
    afterScripts: `<script src="${shell.js}"></script>`,
    onStreamError: (err) => logError(homeLogger, 'home render failed', err),
  });
}

async function buildHomeBody(
  request: Request,
  env: Env,
  user: { id: string; email: string | null },
  filters: ReturnType<typeof parseHomeFilters>,
  browserLocale: Locale,
): Promise<{ body: string; scripts: string }> {
  // The linked-account visibility scope feeds the workspaces rail. The host lookup,
  // the admin check and the scope are independent, so they share one wave.
  const [hostWs, isInstanceAdmin, vis] = await Promise.all([
    hostWorkspaceId(request, env),
    isPlatformAdmin(env, user.email, user.id),
    getVisibilityScope(env, user),
  ]);
  // On a workspace subdomain the host pins the whole surface to that workspace,
  // regardless of (or missing) ?workspace=, so a linked account's personal
  // artifacts never leak into a customer's workspace home.
  if (hostWs) filters.workspace = hostWs;
  // No paid tiers in this build: Knowledge is on wherever a workspace is in play.
  const wsKnowledgePaid = !!hostWs;
  // The inbox address is only real when this instance can receive mail.
  const inboxDomain = env.EMAIL ? inboxEmailDomain(env) : '';

  const createContextWs = hostWs || filters.workspace || null;
  const [
    userInfo,
    workspaces,
    createEnabled,
    wsLocale,
    workspaceRole,
  ] = await Promise.all([
    env.DB.prepare(
      'SELECT name, picture, locale FROM users WHERE id = ?'
    ).bind(user.id).first<{ name: string | null; picture: string | null; locale: string | null }>(),
    // (Recent activity is no longer fetched here — the Activity panel lazy-loads
    // it from /v1/home/activity when opened, keeping it off the first-paint path.
    // Likewise the artifact lists, counts, folders, tags and access requests: the
    // client loads them from /v1/home/* and /v1/access-requests/incoming.)
    // Workspaces rail. Folded into this Promise.all (was a serial query after it)
    // since it only needs `vis`, already resolved above (opt-005 §3.1).
    env.DB.prepare(`
      SELECT w.id, w.name, w.slug, w.branding
      FROM workspaces w
      JOIN workspace_members wm ON wm.workspace_id = w.id
      WHERE wm.user_id IN (${placeholders(vis.userIds.length)})
      GROUP BY w.id
      ORDER BY w.name ASC
      LIMIT 20
    `).bind(...vis.userIds).all<{
      id: string;
      name: string;
      slug: string;
      branding: string | null;
    }>(),
    // Folded into this batch (was a serial await after it) — only needs the
    // create context, known before the queries run.
    isFeatureEnabled(env, CREATE_FEATURE, createContextWs),
    getWorkspaceLocale(env, createContextWs),
    // On a workspace subdomain, the viewer's role gates the Connectors manager.
    hostWs ? getInternalWorkspaceRole(env, hostWs, user.id) : Promise.resolve(null),
  ]);

  // On a workspace subdomain (e.g. acme.shareout.site) only surface that
  // workspace in the rail, so other customers' workspaces never leak into view.
  const allWorkspaces = workspaces.results || [];
  const subdomain = new URL(request.url).hostname.split('.')[0];
  const workspaceList = allWorkspaces.some(w => w.slug === subdomain)
    ? allWorkspaces.filter(w => w.slug === subdomain)
    : allWorkspaces;

  const renderArgs: RenderArgs = {
    user,
    userInfo,
    workspaces: workspaceList,
    workspace: filters.workspace,
    workspaceId: hostWs,
    workspaceRole,
    wsKnowledgePaid,
    inboxDomain,
    isInstanceAdmin,
    slidesImport: !!env.SLIDES_CONVERTER,
    openVisibilityAllowed: !!user.email && (await resolveAllowOpen(env, user.id, null)),
    fileImportProviders: configuredProviders(env),
    platformOrigin: getPlatformOrigin(env),
    appVersion: env.CF_VERSION_METADATA?.id?.slice(0, 7) || '',
    createEnabled,
    locale: (userInfo?.locale || wsLocale) ? resolveLocale({ user: userInfo?.locale, workspace: wsLocale }) : null,
  };

  const view = timeSync(env, 'render', () => buildWorkspaceView(renderArgs));
  // The Server-Timing header went out before these queries ran; the full breakdown
  // (body waves + render) closes the document as a comment.
  const timing = serverTimingValue(env);
  // The shell's i18n runtime reads this locale's copy, so it loads (parser-blocking, in
  // order) before the inline boot globals and the shell script.
  const copyUrl = await homeI18nUrl(renderArgs.locale ?? browserLocale);
  // Shared streaming-chat reading engine for the agent dock (follow/anchor/jump/
  // unread/search/announce). Loaded as a global before the inline hydration script;
  // the dock degrades to its inline fallback if it fails to load.
  return {
    body: `<script src="${versionedBundlePath('/sdk/chat-core.js')}"></script>${view.body}<script src="${copyUrl}"></script>${timing ? `\n<!-- server-timing: ${timing.replace(/--/g, '')} -->` : ''}`,
    scripts: view.bootScript,
  };
}
