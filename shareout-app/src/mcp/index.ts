/**
 * Remote MCP connector: one URL (`{origin}/mcp`) that claude.ai, Claude Desktop and
 * ChatGPT add as a custom connector, signing the person in through ShareOut's own
 * OAuth 2.1 server. Routed before the app pipeline, apex host only.
 *
 * - `oauth`        — metadata, registration, authorize/consent, token, revoke
 * - `server`       — the JSON-RPC endpoint
 * - `tools`        — what the AI app can do (calls the same handlers as the REST API)
 * - `consent-page` — the en/es "allow this app?" page
 */
import type { FetchContext } from '../router/context';
import {
  corsPreflight,
  handleAuthServerMetadata,
  handleAuthorizeGet,
  handleAuthorizePost,
  handleProtectedResourceMetadata,
  handleRegister,
  handleRevoke,
  handleToken,
} from './oauth';
import { handleMcp } from './server';

export { cleanupMcpOAuth } from './oauth';

export async function routeMcp(ctx: FetchContext): Promise<Response | null> {
  const { request, env, path, executionCtx } = ctx;
  const origin = ctx.url.origin;
  const method = request.method;

  if (path === '/mcp' || path === '/mcp/') return handleMcp(request, env, origin, executionCtx);

  if (path === '/.well-known/oauth-protected-resource' || path === '/.well-known/oauth-protected-resource/mcp') {
    return method === 'OPTIONS' ? corsPreflight() : handleProtectedResourceMetadata(origin);
  }
  if (path === '/.well-known/oauth-authorization-server') {
    return method === 'OPTIONS' ? corsPreflight() : handleAuthServerMetadata(origin);
  }

  if (!path.startsWith('/oauth/')) return null;
  if (method === 'OPTIONS') return corsPreflight();
  if (path === '/oauth/register' && method === 'POST') return handleRegister(request, env);
  if (path === '/oauth/authorize' && method === 'GET') return handleAuthorizeGet(request, env, origin);
  if (path === '/oauth/authorize' && method === 'POST') return handleAuthorizePost(request, env, origin);
  if (path === '/oauth/token' && method === 'POST') return handleToken(request, env, origin);
  if (path === '/oauth/revoke' && method === 'POST') return handleRevoke(request, env);
  return null;
}
