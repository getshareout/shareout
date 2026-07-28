import {
  handleListWorkspaces,
  handleCreateWorkspace,
  handleGetWorkspace,
  handleGetWorkspaceBySlug,
  handleUpdateWorkspace,
  handleDeleteWorkspace,
} from '../../workspaces';
import { handleExportWorkspace } from '../../artifacts/export';
import { routeWorkspaceFolders } from './workspace-folders';
import { routeWorkspaceSharees } from './workspace-sharees-routes';
import { routeWorkspaceSettings } from './workspace-settings-routes';
import { routeWorkspaceMembers } from './workspace-members-routes';
import { routeWorkspaceConnections } from './workspace-connections-routes';
import { routeWorkspaceOps } from './workspace-ops-routes';
import { routeWorkspaceAdminArtifacts } from './workspace-admin-artifacts-routes';
import type { FetchContext } from '../context';
import { isAuthUser, requireToken, requireTokenOrSession } from '../helpers/auth-guard';

/**
 * Top-level workspace API router. Matches `/v1/workspaces/*` and related paths,
 * then delegates to focused sub-routers (sharees, settings, members, connections,
 * folders, ops, admin artifacts). Each sub-router returns null when its paths
 * do not match so the chain can fall through.
 */
export async function routeWorkspaceApi(ctx: FetchContext): Promise<Response | null> {
  const { request, env, path, addCORS } = ctx;

  if (path === '/v1/workspaces' && request.method === 'GET') {
    const user = await requireToken(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleListWorkspaces(request, env, user));
  }

  if (path === '/v1/workspaces' && request.method === 'POST') {
    const user = await requireToken(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleCreateWorkspace(request, env, user, ctx.executionCtx));
  }

  const workspaceBySlugMatch = path.match(/^\/v1\/workspaces\/by-slug\/([^/]+)$/);
  if (workspaceBySlugMatch && request.method === 'GET') {
    const [, slug] = workspaceBySlugMatch;
    const user = await requireToken(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleGetWorkspaceBySlug(request, env, user, slug));
  }

  const workspaceExportMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/export$/);
  if (workspaceExportMatch && request.method === 'GET') {
    const [, workspaceId] = workspaceExportMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleExportWorkspace(env, user, workspaceId));
  }

  const workspaceMatch = path.match(/^\/v1\/workspaces\/([^/]+)$/);
  if (workspaceMatch) {
    const [, workspaceId] = workspaceMatch;
    const user = await requireToken(ctx);
    if (!isAuthUser(user)) return user;

    if (request.method === 'GET') {
      return addCORS(await handleGetWorkspace(request, env, user, workspaceId));
    }
    if (request.method === 'PUT' || request.method === 'PATCH') {
      return addCORS(await handleUpdateWorkspace(request, env, user, workspaceId));
    }
    if (request.method === 'DELETE') {
      return addCORS(await handleDeleteWorkspace(request, env, user, workspaceId));
    }
  }

  const delegated =
    (await routeWorkspaceConnections(ctx)) ??
    (await routeWorkspaceSharees(ctx)) ??
    (await routeWorkspaceSettings(ctx)) ??
    (await routeWorkspaceMembers(ctx)) ??
    (await routeWorkspaceFolders(ctx)) ??
    (await routeWorkspaceOps(ctx)) ??
    (await routeWorkspaceAdminArtifacts(ctx));

  return delegated;
}
