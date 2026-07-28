import {
  handleCreateAccessRequest,
  handleDecideAccessRequest,
  handleListIncomingAccessRequests,
} from '../../artifacts/access-requests';
import type { FetchContext } from '../context';
import { isAuthUser, requireAuthUser } from '../helpers/auth-guard';
import { checkAccessRequestLimit, rateLimitResponse } from '../../rate-limit';

export async function routeAccessRequestsApi(ctx: FetchContext): Promise<Response | null> {
  const { request, env, path, addCORS } = ctx;

  if (path === '/v1/access-requests' && request.method === 'POST') {
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    const rl = await checkAccessRequestLimit(env, user.id);
    if (!rl.allowed) return addCORS(rateLimitResponse(rl));
    return addCORS(await handleCreateAccessRequest(request, env, user));
  }

  if (path === '/v1/access-requests/incoming' && request.method === 'GET') {
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleListIncomingAccessRequests(env, user));
  }

  const decideMatch = path.match(/^\/v1\/access-requests\/([^/]+)$/);
  if (decideMatch && request.method === 'POST') {
    const [, requestId] = decideMatch;
    const user = await requireAuthUser(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleDecideAccessRequest(request, env, user, requestId));
  }

  return null;
}
