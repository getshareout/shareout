import {
  handleListWorkspaceMembers,
  handleAddWorkspaceMember,
  handleRemoveWorkspaceMember,
  handleTransferWorkspaceOwnership,
  handleInviteWorkspaceMembers,
  handleListWorkspaceMemberMetrics,
  handleListWorkspacePeople,
} from '../../workspaces';
import { handleRevokeMemberTokens, handleCreateMemberToken } from '../../workspaces-tokens';
import { handleListAgentTokens, handleCreateAgentToken, handleRevokeAgentToken } from '../../agent-tokens';
import { handleListWorkspaceInvites, handleResendWorkspaceInvite, handleRevokeWorkspaceInvite } from '../../workspaces/invites-admin';
import { handleListWorkspaceSharedTables } from './workspace-shared-tables';
import type { FetchContext } from '../context';
import { isAuthUser, requireTokenOrSession } from '../helpers/auth-guard';

/** Workspace membership, invites, people, and token routes.
 *  Split out of workspaces.ts to keep the main router under the size cap.
 *  Sub-routes like /members/metrics must match before /members/:userId. */
export async function routeWorkspaceMembers(ctx: FetchContext): Promise<Response | null> {
  const { request, env, path, addCORS } = ctx;

  const workspaceMembersMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/members$/);
  if (workspaceMembersMatch) {
    const [, workspaceId] = workspaceMembersMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;

    if (request.method === 'GET') {
      return addCORS(await handleListWorkspaceMembers(request, env, user, workspaceId));
    }
    if (request.method === 'POST') {
      return addCORS(await handleAddWorkspaceMember(request, env, user, workspaceId));
    }
  }

  const wsMemberMetricsMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/members\/metrics$/);
  if (wsMemberMetricsMatch && request.method === 'GET') {
    const [, workspaceId] = wsMemberMetricsMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleListWorkspaceMemberMetrics(request, env, user, workspaceId));
  }

  const wsSharedTablesMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/shared-tables$/);
  if (wsSharedTablesMatch && request.method === 'GET') {
    const [, workspaceId] = wsSharedTablesMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleListWorkspaceSharedTables(env, user, workspaceId));
  }

  const wsInviteMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/members\/invite$/);
  if (wsInviteMatch && request.method === 'POST') {
    const [, workspaceId] = wsInviteMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleInviteWorkspaceMembers(request, env, user, workspaceId));
  }

  const wsInviteActionMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/invites\/([^/]+)(\/resend)?$/);
  if (wsInviteActionMatch) {
    const [, workspaceId, inviteId, resend] = wsInviteActionMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    if (resend && request.method === 'POST') {
      return addCORS(await handleResendWorkspaceInvite(request, env, user, workspaceId, inviteId));
    }
    if (!resend && request.method === 'DELETE') {
      return addCORS(await handleRevokeWorkspaceInvite(env, user, workspaceId, inviteId));
    }
  }

  const wsInvitesListMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/invites$/);
  if (wsInvitesListMatch && request.method === 'GET') {
    const [, workspaceId] = wsInvitesListMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleListWorkspaceInvites(env, user, workspaceId));
  }

  const wsPeopleMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/people$/);
  if (wsPeopleMatch && request.method === 'GET') {
    const [, workspaceId] = wsPeopleMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleListWorkspacePeople(request, env, user, workspaceId));
  }

  const wsAgentTokenRevokeMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/agent-tokens\/([^/]+)$/);
  if (wsAgentTokenRevokeMatch && request.method === 'DELETE') {
    const [, workspaceId, tokenId] = wsAgentTokenRevokeMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleRevokeAgentToken(request, env, user, workspaceId, tokenId));
  }

  const wsAgentTokensMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/agent-tokens$/);
  if (wsAgentTokensMatch) {
    const [, workspaceId] = wsAgentTokensMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    if (request.method === 'GET') {
      return addCORS(await handleListAgentTokens(request, env, user, workspaceId));
    }
    if (request.method === 'POST') {
      return addCORS(await handleCreateAgentToken(request, env, user, workspaceId));
    }
  }

  const wsMemberTokensMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/members\/([^/]+)\/tokens$/);
  if (wsMemberTokensMatch) {
    const [, workspaceId, userId] = wsMemberTokensMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    if (request.method === 'DELETE') {
      return addCORS(await handleRevokeMemberTokens(request, env, user, workspaceId, userId));
    }
    if (request.method === 'POST') {
      return addCORS(await handleCreateMemberToken(request, env, user, workspaceId, userId));
    }
  }

  const workspaceMemberMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/members\/([^/]+)$/);
  if (workspaceMemberMatch && request.method === 'DELETE') {
    const [, workspaceId, userId] = workspaceMemberMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleRemoveWorkspaceMember(request, env, user, workspaceId, userId));
  }

  const workspaceTransferMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/transfer-ownership$/);
  if (workspaceTransferMatch && request.method === 'POST') {
    const [, workspaceId] = workspaceTransferMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleTransferWorkspaceOwnership(request, env, user, workspaceId));
  }

  return null;
}
