/**
 * Main request handler: loads home page data and renders the SSR response.
 */
import type { Env } from '../../types';
import { getVisibilityScope, placeholders } from '../../account-links';
import { openVisibilityDisabled } from '../../visibility-config';
import { inboxEmailDomain } from '../../scheduling/email';
import { isPlatformAdmin } from '../../superadmin/auth';
import { getInternalWorkspaceRole } from '../../workspaces';
import { hostWorkspaceId } from './host';
import { parseHomeFilters } from './filters';
import {
  queryHomeArtifactCatalog,
  queryHomeCounts,
  queryPersonalFolders,
  queryTeamFolders,
  queryHomeTags,
} from './queries';
import { buildWorkspaceView, WORKSPACE_STYLES } from './render-workspace';
import { renderHtmlPageStreamed } from '../../design-system/shell';
import type { HtmlPageOptions } from '../../design-system/shell';
import { homePageStyles } from '../../design-system/pages/home.css';
import { listIncomingAccessRequests } from '../../artifacts/access-requests';
import { isFeatureEnabled } from '../../features/flags';
import { isVisualEditorEnabled } from '../../editor/visual-editor-gate';
import { CREATE_FEATURE } from '../create-gate';

/** Head options for the streamed workspace home shell. */
const HOME_HEAD: Omit<HtmlPageOptions, 'body' | 'scripts'> = {
  title: 'My Artifacts · ShareOut',
  pageStyles: homePageStyles,
  bodyClass: 'so-theme-glass',
  cacheControl: 'private, no-cache',
  extraHead: '<link rel="manifest" href="/manifest.webmanifest">',
};

export async function handleUserHomePage(
  request: Request,
  env: Env,
  user: { id: string; email: string | null }
): Promise<Response> {
  const filters = parseHomeFilters(new URL(request.url));
  // On a workspace subdomain the host pins the whole surface to that workspace,
  // regardless of (or missing) ?workspace=, so a linked account's personal
  // artifacts never leak into a customer's workspace home.
  const hostWs = await hostWorkspaceId(request, env);
  if (hostWs) filters.workspace = hostWs;

  // Stream the shell at first byte, then run the per-view queries and stream the
  // real body in underneath. First paint doesn't block on the catalog/sidebar reads.
  return renderHtmlPageStreamed({
    ...HOME_HEAD,
    earlyBody: '',
    body: () => buildHomeBody(request, env, user, filters, hostWs),
  });
}

async function buildHomeBody(
  request: Request,
  env: Env,
  user: { id: string; email: string | null },
  filters: ReturnType<typeof parseHomeFilters>,
  hostWs: string | null,
): Promise<{ body: string; scripts: string }> {
  // On a workspace subdomain, the viewer's role gates the Connectors manager.
  const workspaceRole = hostWs ? await getInternalWorkspaceRole(env, hostWs, user.id) : null;
  // No paid tiers in this build: Skill Marketplace and Knowledge are on wherever a
  // workspace is in play.
  const wsTeamsPlan = !!hostWs;
  const wsKnowledgePaid = !!hostWs;
  // The inbox address is only real when this instance can receive mail.
  const inboxDomain = env.EMAIL ? inboxEmailDomain(env) : '';
  const isInstanceAdmin = await isPlatformAdmin(env, user.email, user.id);
  const { search, sort, type, scope, page } = filters;

  // Resolve the linked-account visibility scope once and thread it into every
  // helper below; otherwise each helper re-resolves it (2 D1 reads apiece).
  const vis = await getVisibilityScope(env, user);

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
  ] = await Promise.all([
    env.DB.prepare(
      'SELECT name, picture FROM users WHERE id = ?'
    ).bind(user.id).first<{ name: string | null; picture: string | null }>(),
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
    listIncomingAccessRequests(env, user.id),
    // Folded into this batch (was a serial await after it) — only needs the
    // create context, known before the queries run.
    isFeatureEnabled(env, CREATE_FEATURE, createContextWs),
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
    accessRequests,
    hostname: new URL(request.url).hostname,
    appVersion: env.CF_VERSION_METADATA?.id?.slice(0, 7) || '',
    visualEditorOffWorkspaces,
    createEnabled,
  };

  const view = buildWorkspaceView(renderArgs);
  // Shared streaming-chat reading engine for the agent dock (follow/anchor/jump/
  // unread/search/announce). Loaded as a global before the inline hydration script;
  // the dock degrades to its inline fallback if it fails to load.
  return {
    body: `<style>${WORKSPACE_STYLES}</style><script src="/sdk/chat-core.js"></script>${view.body}`,
    scripts: view.scripts,
  };
}
