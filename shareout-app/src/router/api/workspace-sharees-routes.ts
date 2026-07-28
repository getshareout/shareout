import {
  handleListSharees, handleCreateSharee, handleGetSharee,
  handleUpdateSharee, handleDeleteSharee,
} from '../../sharees/crud';
import {
  handleListShareeMembers, handleAddShareeMember, handleRemoveShareeMember,
} from '../../sharees/members';
import { handleListGrants, handleCreateGrant, handleDeleteGrant, handleShareWithPerson } from '../../sharees/grants';
import {
  handleListExternalTokens, handleCreateExternalToken, handleRevokeExternalToken,
} from '../../sharees/tokens';
import { handleListShareeActivity } from '../../sharees/activity';
import {
  handleListShareeContext, handleGetShareeContextFile,
  handlePutShareeContextFile, handleDeleteShareeContextFile,
} from '../../workspace-context';
import type { FetchContext } from '../context';
import { isAuthUser, requireTokenOrSession } from '../helpers/auth-guard';

/** External-sharing spine (work/030): Sharee orgs, members, grants, tokens.
 *  Split out of workspaces.ts to keep the main router under the size cap. */
export async function routeWorkspaceSharees(ctx: FetchContext): Promise<Response | null> {
  const { request, env, path, addCORS } = ctx;

  // Token routes are more specific than member-remove, so match them first.
  const shareeTokenOneMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/sharees\/([^/]+)\/members\/([^/]+)\/tokens\/([^/]+)$/);
  if (shareeTokenOneMatch && request.method === 'DELETE') {
    const [, workspaceId, shareeId, memberUserId, tokenId] = shareeTokenOneMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleRevokeExternalToken(request, env, user, workspaceId, shareeId, memberUserId, tokenId));
  }

  const shareeTokensMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/sharees\/([^/]+)\/members\/([^/]+)\/tokens$/);
  if (shareeTokensMatch) {
    const [, workspaceId, shareeId, memberUserId] = shareeTokensMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    if (request.method === 'GET') return addCORS(await handleListExternalTokens(request, env, user, workspaceId, shareeId, memberUserId));
    if (request.method === 'POST') return addCORS(await handleCreateExternalToken(request, env, user, workspaceId, shareeId, memberUserId));
  }

  const shareeMemberRemoveMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/sharees\/([^/]+)\/members\/([^/]+)$/);
  if (shareeMemberRemoveMatch && request.method === 'DELETE') {
    const [, workspaceId, shareeId, memberUserId] = shareeMemberRemoveMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleRemoveShareeMember(request, env, user, workspaceId, shareeId, memberUserId));
  }

  const shareeActivityMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/sharees\/([^/]+)\/activity$/);
  if (shareeActivityMatch && request.method === 'GET') {
    const [, workspaceId, shareeId] = shareeActivityMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleListShareeActivity(request, env, user, workspaceId, shareeId));
  }

  const wsActivityMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/sharee-activity$/);
  if (wsActivityMatch && request.method === 'GET') {
    const [, workspaceId] = wsActivityMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleListShareeActivity(request, env, user, workspaceId));
  }

  const shareeContextFileMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/sharees\/([^/]+)\/context\/([^/]+)$/);
  if (shareeContextFileMatch) {
    const [, workspaceId, shareeId, name] = shareeContextFileMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    if (request.method === 'GET') return addCORS(await handleGetShareeContextFile(env, user, workspaceId, shareeId, name));
    if (request.method === 'PUT') return addCORS(await handlePutShareeContextFile(request, env, user, workspaceId, shareeId, name));
    if (request.method === 'DELETE') return addCORS(await handleDeleteShareeContextFile(env, user, workspaceId, shareeId, name));
  }

  const shareeContextMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/sharees\/([^/]+)\/context$/);
  if (shareeContextMatch && request.method === 'GET') {
    const [, workspaceId, shareeId] = shareeContextMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleListShareeContext(env, user, workspaceId, shareeId));
  }

  const shareeMembersMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/sharees\/([^/]+)\/members$/);
  if (shareeMembersMatch) {
    const [, workspaceId, shareeId] = shareeMembersMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    if (request.method === 'GET') return addCORS(await handleListShareeMembers(request, env, user, workspaceId, shareeId));
    if (request.method === 'POST') return addCORS(await handleAddShareeMember(request, env, user, workspaceId, shareeId));
  }

  const shareeOneMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/sharees\/([^/]+)$/);
  if (shareeOneMatch) {
    const [, workspaceId, shareeId] = shareeOneMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    if (request.method === 'GET') return addCORS(await handleGetSharee(request, env, user, workspaceId, shareeId));
    if (request.method === 'PUT' || request.method === 'PATCH') return addCORS(await handleUpdateSharee(request, env, user, workspaceId, shareeId));
    if (request.method === 'DELETE') return addCORS(await handleDeleteSharee(request, env, user, workspaceId, shareeId));
  }

  const shareesMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/sharees$/);
  if (shareesMatch) {
    const [, workspaceId] = shareesMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    if (request.method === 'GET') return addCORS(await handleListSharees(request, env, user, workspaceId));
    if (request.method === 'POST') return addCORS(await handleCreateSharee(request, env, user, workspaceId));
  }

  const grantOneMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/grants\/([^/]+)$/);
  if (grantOneMatch && request.method === 'DELETE') {
    const [, workspaceId, grantId] = grantOneMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleDeleteGrant(request, env, user, workspaceId, grantId));
  }

  const grantsMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/grants$/);
  if (grantsMatch) {
    const [, workspaceId] = grantsMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    if (request.method === 'GET') return addCORS(await handleListGrants(request, env, user, workspaceId));
    if (request.method === 'POST') return addCORS(await handleCreateGrant(request, env, user, workspaceId));
  }

  const sharePersonMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/share-person$/);
  if (sharePersonMatch && request.method === 'POST') {
    const [, workspaceId] = sharePersonMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleShareWithPerson(request, env, user, workspaceId));
  }

  return null;
}
