/**
 * JSON API handlers for home page client-side refresh (/v1/home/*).
 */
import type { Env } from '../../types';
import { getVisibilityScope, type VisibilityScope } from '../../account-links';
import { quickSearch, type SearchGroup } from '../../search/quick-search';
import { getAccountAnalytics } from '../../analytics';
import { hostWorkspaceId } from './host';
import { renderFolderReadme } from './folder-readme';
import { parseHomeFilters, isLinkedWorkspaceMember } from './filters';
import { queryHomeArtifacts, queryHomeArtifactCatalog, queryHomeCounts, queryForYou, queryRecentlyViewed, recordRecentView } from './queries/artifacts';
import { queryHomeTags } from './queries/tags';
import { queryPersonalFolders, queryTeamFolders, queryFoldersInParent, queryFolderPath, queryFolderReadme, queryFolderAccess, queryPersonalFolderAccess } from './queries/folders';
import { queryRecentActivity, queryRecentComments } from './queries/activity-panels';
import { queryActivityFeed, dismissHomeEvents } from './queries/activity-feed';
import { queryArtifactComments, addArtifactComment } from './queries/comments';
import {
  ALL_KINDS, EVENT_DEFS, isAudience, resolveWorkspaceAudiences, setWorkspaceEventAudience,
  type ActivityKind,
} from './events';
import type { PulseWindow } from './types';
import type { WorkspaceRole } from '../../types';
import { getInternalWorkspaceRole } from '../../workspaces/roles';
import { canManageTeamFolder, membersCanCreateFolders } from '../../folders';
import { isFeatureEnabled } from '../../features/flags';
import { CREATE_FEATURE } from '../create-gate';
import { renderArtifactCard, renderArtifactRow, renderHomeEmptyState, renderRecentActivity, renderRecentComments, renderFolderCard, renderFolderRow } from './render-cards';
import { buildResultLabel } from './utils';
import { jsonWithApiErrors } from '../../http/api-error';
import { getUserProfile, setUserProfile, addFollow, removeFollow, type Follow, type FollowKind } from '../../users/user-profile';

/**
 * Resolve the active workspace: pinned by host on a subdomain, else ?workspace.
 * A workspace the user is not a member of yields a 403 Response.
 */
async function resolveWorkspace(
  request: Request,
  env: Env,
  user: { id: string; email: string | null },
): Promise<string | null | Response> {
  const ws = (await hostWorkspaceId(request, env)) || new URL(request.url).searchParams.get('workspace')?.trim() || null;
  if (!ws) return null;
  if (await isLinkedWorkspaceMember(env, await getVisibilityScope(env, user), ws)) return ws;
  return jsonWithApiErrors({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
}

/**
 * resolveWorkspace + the linked-account visibility scope, for handlers whose queries
 * need it anyway. The host lookup (KV-cached), the scope, the session user's internal
 * role and any `extra` per-workspace read (config, never artifact rows) run in one
 * wave. An internal role already proves membership (user.id is always in
 * vis.userIds), so only a viewer without one pays the linked-account membership query.
 * Same 403 rule as resolveWorkspace.
 */
async function resolveWorkspaceScope<T = undefined>(
  request: Request,
  env: Env,
  user: { id: string; email: string | null },
  extra?: (workspaceId: string | null) => Promise<T>,
): Promise<{ workspaceId: string | null; vis: VisibilityScope; role: WorkspaceRole | null; extra: T } | Response> {
  const param = new URL(request.url).searchParams.get('workspace')?.trim() || null;
  const wsP = hostWorkspaceId(request, env).then((h) => h || param);
  const [workspaceId, vis, role, more] = await Promise.all([
    wsP,
    getVisibilityScope(env, user),
    wsP.then((ws) => (ws ? getInternalWorkspaceRole(env, ws, user.id) : null)),
    extra ? wsP.then(extra) : (undefined as T),
  ]);
  if (workspaceId && !role && !(await isLinkedWorkspaceMember(env, vis, workspaceId))) {
    return jsonWithApiErrors({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }
  return { workspaceId, vis, role, extra: more };
}

const PULSE_WINDOWS: PulseWindow[] = ['today', '7d', '30d'];

/** GET /v1/home/activity-feed — two-surface feed: actionable Needs You + aggregated Pulse. */
export async function handleHomeActivityFeedApi(
  request: Request,
  env: Env,
  user: { id: string; email: string | null },
): Promise<Response> {
  const url = new URL(request.url);
  const ctx = await resolveWorkspaceScope(request, env, user, (ws) => resolveWorkspaceAudiences(env, ws));
  if (ctx instanceof Response) return ctx;
  const { workspaceId, vis, role, extra: aud } = ctx;
  const limit = Number(url.searchParams.get('limit')) || 30;
  const w = url.searchParams.get('window');
  const window: PulseWindow = PULSE_WINDOWS.includes(w as PulseWindow) ? (w as PulseWindow) : '7d';
  const feed = await queryActivityFeed(env, user, { workspaceId, limit, window }, vis, { role, aud });
  return Response.json(feed);
}

/** GET /v1/home/event-visibility — per-kind audience config (admin-facing). */
export async function handleHomeEventVisibilityGetApi(
  request: Request,
  env: Env,
  user: { id: string; email: string | null },
): Promise<Response> {
  const workspaceId = await resolveWorkspace(request, env, user);
  if (workspaceId instanceof Response) return workspaceId;
  const role = workspaceId ? await getInternalWorkspaceRole(env, workspaceId, user.id) : null;
  const canManage = role === 'owner' || role === 'admin';
  const audiences = await resolveWorkspaceAudiences(env, workspaceId);
  const kinds = ALL_KINDS.map((k) => ({
    kind: k, label: EVENT_DEFS[k].label, hint: EVENT_DEFS[k].hint,
    tier: EVENT_DEFS[k].tier, defaultAudience: EVENT_DEFS[k].defaultAudience,
    audience: audiences[k],
  }));
  return Response.json({ kinds, canManage, scoped: !!workspaceId });
}

/** PUT /v1/home/event-visibility — set one kind's audience ({ kind, audience }). Admin only. */
export async function handleHomeEventVisibilitySetApi(
  request: Request,
  env: Env,
  user: { id: string; email: string | null },
): Promise<Response> {
  const workspaceId = await resolveWorkspace(request, env, user);
  if (workspaceId instanceof Response) return workspaceId;
  if (!workspaceId) return jsonWithApiErrors({ error: 'workspace required', code: 'VALIDATION_ERROR', param: 'workspace' }, 400);
  const role = await getInternalWorkspaceRole(env, workspaceId, user.id);
  if (role !== 'owner' && role !== 'admin') return jsonWithApiErrors({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  const body = ((await request.json().catch(() => null)) ?? {}) as { kind?: unknown; audience?: unknown };
  if (typeof body.kind !== 'string' || !(body.kind in EVENT_DEFS) || !isAudience(body.audience)) {
    return jsonWithApiErrors({ error: 'invalid kind/audience', code: 'VALIDATION_ERROR', param: typeof body.kind === 'string' && body.kind in EVENT_DEFS ? 'audience' : 'kind' }, 400);
  }
  await setWorkspaceEventAudience(env, workspaceId, body.kind as ActivityKind, body.audience, user.id);
  return Response.json({ ok: true });
}

/** GET /v1/home/for-you — relevance-ranked artifact cards for the Brief. */
export async function handleHomeForYouApi(
  request: Request,
  env: Env,
  user: { id: string; email: string | null },
): Promise<Response> {
  const url = new URL(request.url);
  const ctx = await resolveWorkspaceScope(request, env, user);
  if (ctx instanceof Response) return ctx;
  const { workspaceId, vis } = ctx;
  const limit = Number(url.searchParams.get('limit')) || 12;
  const artifacts = await queryForYou(env, user, { workspaceId, limit }, vis);
  return Response.json({
    cardsHtml: artifacts.map((a) => renderArtifactCard(a, url.hostname, env)).join(''),
    rowsHtml: artifacts.map((a) => renderArtifactRow(a, url.hostname)).join(''),
    count: artifacts.length,
  });
}

/** GET /v1/home/recent — artifacts the user recently opened, as cards. */
export async function handleHomeRecentApi(
  request: Request,
  env: Env,
  user: { id: string; email: string | null },
): Promise<Response> {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get('limit')) || 24;
  const ctx = await resolveWorkspaceScope(request, env, user);
  if (ctx instanceof Response) return ctx;
  const { workspaceId, vis } = ctx;
  const artifacts = await queryRecentlyViewed(env, user, { workspaceId, limit }, vis);
  return Response.json({
    cardsHtml: artifacts.map((a) => renderArtifactCard(a, url.hostname, env)).join(''),
    rowsHtml: artifacts.map((a) => renderArtifactRow(a, url.hostname)).join(''),
    count: artifacts.length,
  });
}

/**
 * GET /v1/home/quick-search?q=&workspace=&groups=&limit= — ranked fuzzy palette search.
 * Powers the Cmd+K palette and inline dropdown. Empty q returns recents.
 */
export async function handleHomeQuickSearchApi(
  request: Request,
  env: Env,
  user: { id: string; email: string | null },
): Promise<Response> {
  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim() || '';
  const workspaceId = (await hostWorkspaceId(request, env)) || url.searchParams.get('workspace')?.trim() || undefined;
  const limit = Math.min(Number(url.searchParams.get('limit')) || 8, 20);
  const groupsParam = url.searchParams.get('groups')?.trim();
  const groups = groupsParam
    ? (groupsParam.split(',').map((g) => g.trim()).filter(Boolean) as SearchGroup[])
    : undefined;
  const result = await quickSearch(env, user.id, { q, workspaceId, groups, limit });
  return Response.json(result);
}

/** GET /v1/home/comments?artifactId=|slug=&limit= — comments on one artifact for the Inspector.
 *  `slug` lets the Inspector load a deep-linked artifact without first waiting on
 *  /v1/artifacts/<slug> for its id (resolved the same way that endpoint does). */
export async function handleHomeCommentsApi(
  request: Request,
  env: Env,
  user: { id: string; email: string | null },
): Promise<Response> {
  const url = new URL(request.url);
  let artifactId = url.searchParams.get('artifactId')?.trim();
  const slug = url.searchParams.get('slug')?.trim();
  if (!artifactId && slug) {
    const row = await env.DB.prepare(
      'SELECT id FROM artifacts WHERE (id = ? OR slug = ?) AND deleted_at IS NULL ORDER BY id = ? DESC LIMIT 1'
    ).bind(slug, slug, slug).first<{ id: string }>();
    if (!row) return Response.json({ comments: [], count: 0 });
    artifactId = row.id;
  }
  if (!artifactId) return Response.json({ error: 'artifactId required' }, { status: 400 });
  const limit = Number(url.searchParams.get('limit')) || 100;
  const comments = await queryArtifactComments(env, user, artifactId, limit);
  return Response.json({ comments, count: comments.length });
}

/** POST /v1/home/comments — add a comment/reply ({ artifactId, content, parentId? }). */
export async function handleHomeCommentPostApi(
  request: Request,
  env: Env,
  user: { id: string; email: string | null },
): Promise<Response> {
  const body = await request.json().catch(() => ({})) as { artifactId?: unknown; content?: unknown; parentId?: unknown; mentions?: unknown; position?: unknown };
  if (typeof body.artifactId !== 'string' || !body.artifactId) return Response.json({ error: 'artifactId required' }, { status: 400 });
  if (typeof body.content !== 'string' || !body.content.trim()) return Response.json({ error: 'content required' }, { status: 400 });
  const parentId = typeof body.parentId === 'string' && body.parentId ? body.parentId : null;
  const mentions = Array.isArray(body.mentions) ? body.mentions.filter((m): m is string => typeof m === 'string') : undefined;
  const position = body.position && typeof body.position === 'object' ? body.position : undefined;
  const comment = await addArtifactComment(env, user, body.artifactId, body.content, parentId, { mentions, position });
  if (!comment) return Response.json({ error: 'forbidden' }, { status: 403 });
  return Response.json({ comment });
}

/** POST /v1/home/dismiss-event — hide actionable "Needs you" events ({ eventIds | eventId }). */
export async function handleHomeDismissEventApi(
  request: Request,
  env: Env,
  user: { id: string; email: string | null },
): Promise<Response> {
  const body = ((await request.json().catch(() => null)) ?? {}) as { eventIds?: unknown; eventId?: unknown };
  const ids = Array.isArray(body.eventIds)
    ? (body.eventIds.filter((x) => typeof x === 'string') as string[])
    : (typeof body.eventId === 'string' ? [body.eventId] : []);
  if (!ids.length) return jsonWithApiErrors({ error: 'eventIds required', code: 'VALIDATION_ERROR', param: 'eventIds' }, 400);
  await dismissHomeEvents(env, user.id, ids);
  return Response.json({ ok: true });
}

/** POST /v1/home/viewed — record that the user opened an artifact ({ artifactId }). */
export async function handleHomeRecordViewApi(
  request: Request,
  env: Env,
  user: { id: string; email: string | null },
): Promise<Response> {
  const body = await request.json().catch(() => ({})) as { artifactId?: unknown };
  if (typeof body.artifactId !== 'string' || !body.artifactId) {
    return Response.json({ error: 'artifactId required' }, { status: 400 });
  }
  await recordRecentView(env, user.id, body.artifactId);
  return Response.json({ ok: true });
}

/** GET /v1/home/profile — the user's agent memory (user.md) + follows. */
export async function handleHomeProfileGetApi(
  _request: Request,
  env: Env,
  user: { id: string; email: string | null },
): Promise<Response> {
  const p = await getUserProfile(env, user.id);
  return Response.json({ profileMd: p.profileMd, follows: p.follows, updatedAt: p.updatedAt });
}

/** PUT /v1/home/profile — overwrite the markdown memory. */
export async function handleHomeProfileSetApi(
  request: Request,
  env: Env,
  user: { id: string; email: string | null },
): Promise<Response> {
  const body = await request.json().catch(() => ({})) as { profileMd?: unknown };
  if (typeof body.profileMd !== 'string') {
    return Response.json({ error: 'profileMd (string) required' }, { status: 400 });
  }
  await setUserProfile(env, user.id, body.profileMd);
  return Response.json({ ok: true });
}

const FOLLOW_KINDS: FollowKind[] = ['artifact', 'metric', 'topic'];

/** POST /v1/home/follow — add or remove a follow ({ action, follow }). */
export async function handleHomeFollowApi(
  request: Request,
  env: Env,
  user: { id: string; email: string | null },
): Promise<Response> {
  const body = await request.json().catch(() => ({})) as { action?: string; follow?: Partial<Follow> };
  const f = body.follow;
  if (!f || !FOLLOW_KINDS.includes(f.kind as FollowKind) || typeof f.ref !== 'string' || !f.ref) {
    return Response.json({ error: 'invalid follow' }, { status: 400 });
  }
  const follow: Follow = { kind: f.kind as FollowKind, ref: f.ref };
  const follows = body.action === 'remove'
    ? await removeFollow(env, user.id, follow)
    : await addFollow(env, user.id, follow);
  return Response.json({ follows });
}

export async function handleHomeActivityApi(
  request: Request,
  env: Env,
  user: { id: string; email: string | null },
): Promise<Response> {
  const workspaceId = await resolveWorkspace(request, env, user);
  if (workspaceId instanceof Response) return workspaceId;
  const rows = await queryRecentActivity(env, user, workspaceId);
  return Response.json({ html: renderRecentActivity(rows) });
}

export async function handleHomeCommentActivityApi(
  request: Request,
  env: Env,
  user: { id: string; email: string | null },
): Promise<Response> {
  const workspaceId = await resolveWorkspace(request, env, user);
  if (workspaceId instanceof Response) return workspaceId;
  const rows = await queryRecentComments(env, user, workspaceId);
  return Response.json({ html: renderRecentComments(rows) });
}

export async function handleHomeAnalyticsApi(
  request: Request,
  env: Env,
  user: { id: string; email: string | null },
): Promise<Response> {
  const raw = Number(new URL(request.url).searchParams.get('range'));
  const range = raw === 7 || raw === 90 ? raw : 30;
  const ctx = await resolveWorkspaceScope(request, env, user);
  if (ctx instanceof Response) return ctx;
  const data = await getAccountAnalytics(env, ctx.vis.userIds, range, ctx.workspaceId || undefined);
  return Response.json(data);
}

export async function handleHomeCountsApi(
  request: Request,
  env: Env,
  user: { id: string; email: string | null },
): Promise<Response> {
  const counts = await queryHomeCounts(env, user, await hostWorkspaceId(request, env));
  return Response.json(counts);
}

export async function handleHomeCatalogApi(
  request: Request,
  env: Env,
  user: { id: string; email: string | null },
): Promise<Response> {
  // On a workspace subdomain the host pins the context; on the apex it comes from
  // the query param. Counts follow the subdomain (workspace-scoped) or stay personal.
  const hostWs = await hostWorkspaceId(request, env);
  const url = new URL(request.url);
  const workspace = hostWs || (url.searchParams.get('workspace')?.trim() || '');
  const filters = parseHomeFilters(url);
  if (hostWs) filters.workspace = hostWs;
  const catalogWs = workspace && filters.filesScope !== 'personal' ? workspace : null;
  const vis = await getVisibilityScope(env, user);
  const hostname = url.hostname;
  const [catalog, counts, teamFolders, personalFolders, tags] = await Promise.all([
    queryHomeArtifactCatalog(env, user, catalogWs, vis),
    queryHomeCounts(env, user, hostWs, vis),
    workspace ? queryTeamFolders(env, user, workspace, vis) : Promise.resolve([]),
    queryPersonalFolders(env, user, vis),
    queryHomeTags(env, user, catalogWs, vis),
  ]);
  return Response.json({
    workspace,
    filesScope: filters.filesScope,
    allCount: counts.allCount,
    favCount: counts.favCount,
    sharedCount: counts.sharedCount,
    catalogSize: catalog.artifacts.length,
    truncated: catalog.truncated,
    cardsHtml: catalog.truncated ? '' : catalog.artifacts.map(a => renderArtifactCard(a, hostname, env)).join(''),
    folders: filters.filesScope === 'personal' ? personalFolders : teamFolders,
    teamFolders,
    personalFolders,
    tags,
  });
}

export async function handleHomeBrowserApi(
  request: Request,
  env: Env,
  user: { id: string; email: string | null },
): Promise<Response> {
  const filters = parseHomeFilters(new URL(request.url));
  // Host lookup and visibility scope are independent: one wave.
  const [hostWs, vis] = await Promise.all([hostWorkspaceId(request, env), getVisibilityScope(env, user)]);
  if (hostWs) filters.workspace = hostWs;
  const hostname = new URL(request.url).hostname;
  const createContextWs = hostWs || filters.workspace || null;

  // Folder context: return the level's folders + can-manage flags, plus (inside a folder)
  // the root-to-current breadcrumb trail. Nesting repeats the root behaviour at any depth
  // (arbitrary depth via parent_id). Personal folders are always the user's to manage.
  // Team Space: admins/owners manage every folder; members create folders and manage the
  // ones they created while the workspace allows it (members_can_create_folders).
  // canManageFolders = may create folders here (New folder); canEditFolder = may edit the
  // open folder (guide); each card carries its own rename/delete affordance.
  const folderScope: 'workspace' | 'personal' = hostWs ? 'workspace' : 'personal';
  const workspaceId = hostWs || null;
  const folderId = filters.folder;

  // Every read below depends only on (hostWs, vis, filters), so they run as one wave;
  // the role-gated reads chain off the role lookup instead of waiting for the rest.
  const roleP = (async () => {
    const role = hostWs ? await getInternalWorkspaceRole(env, hostWs, user.id) : null;
    const memberCreates = !!hostWs && role === 'member' && await membersCanCreateFolders(env, hostWs);
    return { role, memberCreates };
  })();
  const [createEnabled, page, { role, memberCreates }, folderPath, folderReadme, openFolder, folderAccess, folders] = await Promise.all([
    isFeatureEnabled(env, CREATE_FEATURE, createContextWs),
    queryHomeArtifacts(env, user, filters, vis),
    roleP,
    folderId ? queryFolderPath(env, user, { workspaceId, folderId }, vis) : Promise.resolve([] as { id: string; name: string }[]),
    folderId ? queryFolderReadme(env, user, { workspaceId, folderId }, vis) : Promise.resolve(null),
    folderId ? roleP.then(r => r.memberCreates
      ? env.DB.prepare('SELECT created_by FROM folders WHERE id = ? AND workspace_id = ?')
        .bind(folderId, hostWs).first<{ created_by: string | null }>()
      : null) : Promise.resolve(null),
    !folderId ? Promise.resolve(null)
      : !hostWs ? queryPersonalFolderAccess(env, vis.userIds, folderId)
      : roleP.then(r => r.role ? queryFolderAccess(env, hostWs, folderId) : null),
    queryFoldersInParent(env, user, { workspaceId, parentId: folderId || null }, vis),
  ]);
  const { artifacts, total, totalPages } = page;
  const canManageFolders = !hostWs || role === 'owner' || role === 'admin' || memberCreates;
  const canManage = (createdBy: string | null | undefined) =>
    !hostWs || canManageTeamFolder(role, memberCreates, createdBy ?? null, user.id);
  let canEditFolder = canManageFolders && !memberCreates;
  if (folderId && memberCreates) canEditFolder = canManage(openFolder?.created_by);
  const folderName: string | null = folderPath.length ? folderPath[folderPath.length - 1].name : null;
  const foldersHtml = folders.map(f => renderFolderCard(f, folderScope, canManage(f.created_by))).join('');

  return Response.json({
    cardsHtml: artifacts.map(a => renderArtifactCard(a, hostname, env)).join(''),
    rowsHtml: artifacts.map(a => renderArtifactRow(a, hostname)).join(''),
    emptyHtml: artifacts.length === 0 ? renderHomeEmptyState(filters, createEnabled) : '',
    foldersHtml,
    folderRowsHtml: folders.map(renderFolderRow).join(''),
    folderName,
    folderPath,
    folderReadme,
    folderReadmeHtml: renderFolderReadme(folderReadme),
    folderScope,
    canManageFolders,
    canEditFolder,
    // Names of the items more open than the folder are for whoever can fix them;
    // everyone else gets the truthful pill and counts only.
    folderAccess: folderAccess && !canEditFolder ? { ...folderAccess, openItems: undefined } : folderAccess,
    hasMore: filters.page < totalPages,
    resultLabel: buildResultLabel(filters, total),
    total,
    totalPages,
    page: filters.page,
  });
}
