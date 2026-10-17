/**
 * Main request handler: loads home page data and renders the SSR response.
 */
import type { Env } from '../../types';
import { configuredProviders } from '../../file-imports/oauth';
import { getVisibilityScope, placeholders } from '../../account-links';
import { openVisibilityDisabled } from '../../visibility-config';
import { inboxEmailDomain } from '../../scheduling/email';
import { getPlatformOrigin } from '../../config/origins';
import { isPlatformAdmin } from '../../superadmin/auth';
import { getInternalWorkspaceRole } from '../../workspaces/roles';
import { hostWorkspaceId } from './host';
import { parseHomeFilters } from './filters';
import { queryHomeArtifactCatalog, queryHomeCounts } from './queries/artifacts';
import { queryPersonalFolders, queryTeamFolders } from './queries/folders';
import { queryHomeTags } from './queries/tags';
import { buildWorkspaceView } from './render-workspace';
import { homeI18nUrl, homeShellUrls } from './shell-assets';
import { renderHtmlPageStreamed } from '../../design-system/shell';
import type { HtmlPageOptions } from '../../design-system/shell';
import { listIncomingAccessRequests } from '../../artifacts/access-requests';
import { isFeatureEnabled } from '../../features/flags';
import { isVisualEditorEnabled } from '../../editor/visual-editor-gate';
import { CREATE_FEATURE } from '../create-gate';
import { versionedBundlePath } from '../../bundle-versions';
import { createLogger, logError } from '../../logging';
import { getWorkspaceLocale, localeFromAcceptLanguage, resolveLocale, type Locale } from '../../i18n/locale';
import { serverTimingValue, timeSync } from '../../http/request-scope';

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

  // Stream the shell at first byte, then run the per-view queries and stream the
  // real body in underneath. First paint doesn't block on the catalog/sidebar reads
  // (nor on the host lookup: the head does not depend on it).
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
  // Resolve the linked-account visibility scope once and thread it into every
  // helper below; otherwise each helper re-resolves it. The host lookup, the admin
  // check and the scope are independent, so they share one wave.
  const [hostWs, isInstanceAdmin, vis] = await Promise.all([
    hostWorkspaceId(request, env),
    isPlatformAdmin(env, user.email, user.id),
    getVisibilityScope(env, user),
  ]);
  // On a workspace subdomain the host pins the whole surface to that workspace,
  // regardless of (or missing) ?workspace=, so a linked account's personal
  // artifacts never leak into a customer's workspace home.
  if (hostWs) filters.workspace = hostWs;
  // No paid tiers in this build: Skill Marketplace and Knowledge are on wherever a
  // workspace is in play.
  const wsTeamsPlan = !!hostWs;
  const wsKnowledgePaid = !!hostWs;
  // The inbox address is only real when this instance can receive mail.
  const inboxDomain = env.EMAIL ? inboxEmailDomain(env) : '';
  const { search, sort, type, scope, page } = filters;

  const createContextWs = hostWs || filters.workspace || null;
  const catalogWs = createContextWs && filters.filesScope !== 'personal' ? createContextWs : null;
  const [
    userInfo,
    catalog,
    counts,
    teamFolders,
    personalFolders,
    tags,
    workspaces,
    accessRequests,
    createEnabled,
    wsLocale,
    workspaceRole,
  ] = await Promise.all([
    env.DB.prepare(
      'SELECT name, picture, locale FROM users WHERE id = ?'
    ).bind(user.id).first<{ name: string | null; picture: string | null; locale: string | null }>(),
    queryHomeArtifactCatalog(env, user, catalogWs, vis),
    queryHomeCounts(env, user, hostWs, vis),
    createContextWs ? queryTeamFolders(env, user, createContextWs, vis) : Promise.resolve([]),
    queryPersonalFolders(env, user, vis),
    queryHomeTags(env, user, catalogWs, vis),
    // (Recent activity is no longer fetched here — the Activity panel lazy-loads
    // it from /v1/home/activity when opened, keeping it off the first-paint path.)
    // Workspaces rail. Folded into this Promise.all (was a serial query after it)
    // since it only needs `vis`, already resolved above (opt-005 §3.1).
    env.DB.prepare(`
      SELECT w.id, w.name, w.slug, w.branding,
             (SELECT COUNT(*) FROM artifacts a WHERE a.workspace_id = w.id) as artifact_count,
             MAX(CASE wm.role WHEN 'owner' THEN 3 WHEN 'admin' THEN 2 ELSE 1 END) as role_rank
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
      artifact_count: number;
      role_rank: number;
    }>(),
    listIncomingAccessRequests(env, user.id, createContextWs),
    // Folded into this batch (was a serial await after it) — only needs the
    // create context, known before the queries run.
    isFeatureEnabled(env, CREATE_FEATURE, createContextWs),
    getWorkspaceLocale(env, createContextWs),
    // On a workspace subdomain, the viewer's role gates the Connectors manager.
    hostWs ? getInternalWorkspaceRole(env, hostWs, user.id) : Promise.resolve(null),
  ]);

  const { allCount, favCount, sharedCount } = counts;

  // On a workspace subdomain (e.g. acme.shareout.site) only surface that
  // workspace in the rail, so other customers' workspaces never leak into view.
  const allWorkspaces = (workspaces.results || []).map(w => ({
    id: w.id,
    name: w.name,
    slug: w.slug,
    branding: w.branding,
    artifact_count: w.artifact_count,
    can_manage: (w.role_rank ?? 1) >= 2,
  }));
  const subdomain = new URL(request.url).hostname.split('.')[0];
  const workspaceList = allWorkspaces.some(w => w.slug === subdomain)
    ? allWorkspaces.filter(w => w.slug === subdomain)
    : allWorkspaces;

  const visualEditorOffWorkspaces: string[] = [];
  await Promise.all(workspaceList.map(async (w) => {
    if (!(await isVisualEditorEnabled(env, w.id, user.email))) {
      visualEditorOffWorkspaces.push(w.id);
    }
  }));

  const renderArgs = {
    user,
    userInfo,
    catalog: catalog.artifacts,
    catalogTruncated: catalog.truncated,
    catalogTotal: catalog.total,
    allCount,
    favCount,
    sharedCount,
    workspaces: workspaceList,
    folders: catalogWs ? teamFolders : personalFolders,
    teamFolders,
    personalFolders,
    filesScope: filters.filesScope,
    folderKind: filters.folderKind,
    folder: filters.folder,
    tags,
    search,
    sort,
    type,
    scope,
    workspace: filters.workspace,
    page: filters.page,
    openVisDisabled: openVisibilityDisabled(env),
    workspaceId: hostWs,
    workspaceRole,
    wsTeamsPlan,
    wsKnowledgePaid,
    inboxDomain,
    isInstanceAdmin,
    slidesImport: !!env.SLIDES_CONVERTER,
    fileImportProviders: configuredProviders(env),
    platformOrigin: getPlatformOrigin(env),
    accessRequests,
    hostname: new URL(request.url).hostname,
    appVersion: env.CF_VERSION_METADATA?.id?.slice(0, 7) || '',
    visualEditorOffWorkspaces,
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
