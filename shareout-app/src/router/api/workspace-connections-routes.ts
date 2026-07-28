import {
  handleListWorkspaceConnections,
  handleWorkspaceConnectorsCatalog,
  handleTestWorkspaceConnection,
  handleGetWorkspaceConnection,
  handleListConnectionArtifacts,
  handleCreateWorkspaceConnection,
  handleDeleteWorkspaceConnection,
  handleUpdateWorkspaceConnection,
  handleGetMyConnectionCredentials,
  handlePutMyConnectionCredentials,
  handleDeleteMyConnectionCredentials,
  handleWorkspaceOAuthUrl,
  handleWorkspaceOAuthCallback,
  handleSlackInstall,
  handleSlackOAuthCallback,
  handleListSlackChannels,
} from './workspace-connections';
import {
  handleGetWorkspaceLlm,
  handleSetWorkspaceByoKey,
  handleDeleteWorkspaceByoKey,
  handleGetWorkspaceUsage,
} from './workspace-llm';
import { handleGetWorkspaceCrewUsage } from './workspace-crew-usage';
import type { FetchContext } from '../context';
import { isAuthUser, requireTokenOrSession, getTokenOrSessionUser } from '../helpers/auth-guard';

/** Data Platform connections, OAuth callbacks, LLM billing, and usage routes.
 *  Split out of workspaces.ts to keep the main router under the size cap. */
export async function routeWorkspaceConnections(ctx: FetchContext): Promise<Response | null> {
  const { request, env, path, addCORS } = ctx;

  if (path === '/v1/oauth/slack/callback' && request.method === 'GET') {
    const sessionUser = await getTokenOrSessionUser(ctx);
    return addCORS(await handleSlackOAuthCallback(request, env, sessionUser?.id ?? null));
  }

  const connOAuthCallbackMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/connections\/([^/]+)\/callback$/);
  if (connOAuthCallbackMatch && request.method === 'GET') {
    const [, workspaceId, providerId] = connOAuthCallbackMatch;
    const sessionUser = await getTokenOrSessionUser(ctx);
    return addCORS(await handleWorkspaceOAuthCallback(request, env, workspaceId, providerId, sessionUser?.id ?? null));
  }

  const slackInstallMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/connections\/slack\/install$/);
  if (slackInstallMatch && request.method === 'GET') {
    const [, workspaceId] = slackInstallMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleSlackInstall(request, env, user, workspaceId));
  }

  const slackChannelsMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/connections\/([^/]+)\/slack\/channels$/);
  if (slackChannelsMatch && request.method === 'GET') {
    const [, workspaceId, connectionName] = slackChannelsMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleListSlackChannels(env, user, workspaceId, connectionName));
  }

  const connOAuthUrlMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/connections\/([^/]+)\/auth-url$/);
  if (connOAuthUrlMatch && request.method === 'GET') {
    const [, workspaceId, providerId] = connOAuthUrlMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleWorkspaceOAuthUrl(request, env, user, workspaceId, providerId));
  }

  const llmMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/llm$/);
  if (llmMatch) {
    const [, workspaceId] = llmMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;

    if (request.method === 'GET') {
      return addCORS(await handleGetWorkspaceLlm(env, user, workspaceId));
    }
    if (request.method === 'PUT' || request.method === 'PATCH') {
      return addCORS(await handleSetWorkspaceByoKey(request, env, user, workspaceId));
    }
    if (request.method === 'DELETE') {
      return addCORS(await handleDeleteWorkspaceByoKey(env, user, workspaceId));
    }
  }

  const usageMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/usage$/);
  if (usageMatch && request.method === 'GET') {
    const [, workspaceId] = usageMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleGetWorkspaceUsage(request, env, user, workspaceId));
  }

  const crewUsageMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/crew-usage$/);
  if (crewUsageMatch && request.method === 'GET') {
    const [, workspaceId] = crewUsageMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleGetWorkspaceCrewUsage(request, env, user, workspaceId));
  }

  const connectionsMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/connections$/);
  if (connectionsMatch) {
    const [, workspaceId] = connectionsMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;

    if (request.method === 'GET') {
      return addCORS(await handleListWorkspaceConnections(env, user, workspaceId));
    }
    if (request.method === 'POST') {
      return addCORS(await handleCreateWorkspaceConnection(request, env, user, workspaceId, ctx.executionCtx));
    }
  }

  const connCatalogMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/connections\/catalog$/);
  if (connCatalogMatch && request.method === 'GET') {
    const [, workspaceId] = connCatalogMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleWorkspaceConnectorsCatalog(env, user, workspaceId));
  }

  const connTestMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/connections\/test$/);
  if (connTestMatch && request.method === 'POST') {
    const [, workspaceId] = connTestMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleTestWorkspaceConnection(request, env, user, workspaceId));
  }

  const connArtifactsMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/connections\/([^/]+)\/artifacts$/);
  if (connArtifactsMatch && request.method === 'GET') {
    const [, workspaceId, connectionId] = connArtifactsMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleListConnectionArtifacts(env, user, workspaceId, connectionId));
  }

  const myCredentialsMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/connections\/([^/]+)\/my-credentials$/);
  if (myCredentialsMatch) {
    const [, workspaceId, connectionId] = myCredentialsMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;

    if (request.method === 'GET') {
      return addCORS(await handleGetMyConnectionCredentials(env, user, workspaceId, connectionId));
    }
    if (request.method === 'PUT') {
      return addCORS(await handlePutMyConnectionCredentials(request, env, user, workspaceId, connectionId));
    }
    if (request.method === 'DELETE') {
      return addCORS(await handleDeleteMyConnectionCredentials(env, user, workspaceId, connectionId));
    }
  }

  const connectionMatch = path.match(/^\/v1\/workspaces\/([^/]+)\/connections\/([^/]+)$/);
  if (connectionMatch && request.method === 'GET') {
    const [, workspaceId, connectionId] = connectionMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleGetWorkspaceConnection(env, user, workspaceId, connectionId));
  }
  if (connectionMatch && request.method === 'DELETE') {
    const [, workspaceId, connectionId] = connectionMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleDeleteWorkspaceConnection(env, user, workspaceId, connectionId));
  }
  if (connectionMatch && request.method === 'PATCH') {
    const [, workspaceId, connectionId] = connectionMatch;
    const user = await requireTokenOrSession(ctx);
    if (!isAuthUser(user)) return user;
    return addCORS(await handleUpdateWorkspaceConnection(request, env, user, workspaceId, connectionId));
  }

  return null;
}
