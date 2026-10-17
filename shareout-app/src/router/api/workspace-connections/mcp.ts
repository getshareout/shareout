/**
 * MCP connector routes. An admin adds a remote MCP server once (discovery +
 * client registration); each member then connects their own account through
 * OAuth, and their tokens are stored per user.
 */
import type { Env } from '../../../types';
import type { AuthUser } from '../../../api-auth';
import { generateId } from '../../../crypto-utils';
import { encryptCredentials } from '../../../data/connections/credentials';
import { saveUserConnectionCredentials } from '../../../data/connections/user-credentials';
import { logAudit } from '../../../audit';
import { createLogger, logError } from '../../../logging';
import { createOAuthState, sameOriginReturnUrl, verifyOAuthState } from '../../../oauth-state';
import { pkceChallenge } from '../../../mcp/oauth';
import { McpClientError, refuseDestination } from '../../../mcp-client/http';
import { canonicalServerUri, discoverAuth } from '../../../mcp-client/discovery';
import {
  buildAuthorizeUrl,
  clientMetadataDocument,
  exchangeCode,
  registerClient,
  type McpConnectionConfig,
} from '../../../mcp-client/oauth';
import { loadMcpConnection, MCP_PROVIDER, refreshMcpTools } from '../../../mcp-client/connection';
import { renderWorkspaceConnectionCallbackPage } from './callback-page';
import { oauthDenialMessage } from './errors';
import { json, requireAdmin, requireMember, validateName } from './shared';

const STATE_PURPOSE = 'mcp-connect';
const PKCE_TTL_SECONDS = 10 * 60;
const pkceKey = (nonce: string) => `mcp-pkce:${nonce}`;

interface ConnectState {
  workspaceId: string;
  connectionId: string;
  nonce: string;
  returnUrl: string;
}

function randomUrlSafe(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...buf)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function mcpError(err: unknown): Response {
  if (err instanceof McpClientError) {
    const status = err.code === 'blocked_destination' || err.code === 'registration_unsupported' ? 400 : 502;
    return json({ error: err.message, code: err.code.toUpperCase() }, status);
  }
  throw err;
}

// GET /oauth/mcp-client.json — Client ID Metadata Document (the client_id is this URL)
export function handleMcpClientMetadata(env: Env): Response {
  return new Response(JSON.stringify(clientMetadataDocument(env)), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600' },
  });
}

// POST /v1/workspaces/{id}/mcp-connections — admin adds a remote MCP server
export async function handleCreateMcpConnection(request: Request, env: Env, user: AuthUser, workspaceId: string): Promise<Response> {
  if (!(await requireAdmin(env, workspaceId, user.id))) {
    return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }
  if (!env.CREDENTIALS_KEY) {
    return json({ error: 'CREDENTIALS_KEY not configured', code: 'CONFIG_ERROR' }, 500);
  }

  let body: { name?: string; serverUrl?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body', code: 'INVALID_JSON' }, 400);
  }
  const nameError = validateName(body.name ?? '');
  if (nameError) return json({ error: nameError, code: 'VALIDATION_ERROR' }, 400);

  let serverUrl: string;
  try {
    serverUrl = canonicalServerUri(body.serverUrl ?? '');
  } catch {
    return json({ error: 'serverUrl must be an absolute https URL', code: 'VALIDATION_ERROR' }, 400);
  }
  const refusal = refuseDestination(env, new URL(serverUrl));
  if (refusal) return json({ error: refusal, code: 'VALIDATION_ERROR' }, 400);

  const existing = await env.DB.prepare(
    "SELECT id FROM connections WHERE scope_type = 'workspace' AND scope_id = ? AND name = ?",
  ).bind(workspaceId, body.name).first();
  if (existing) return json({ error: 'Connection already exists', code: 'CONFLICT' }, 409);

  let config: McpConnectionConfig;
  let clientSecret: string | undefined;
  try {
    const discovered = await discoverAuth(env, serverUrl);
    if (discovered.auth === 'none') {
      config = { serverUrl, auth: 'none' };
    } else {
      const registered = await registerClient(env, discovered.oauth);
      config = { serverUrl, auth: 'oauth', oauth: registered.client };
      clientSecret = registered.clientSecret;
    }
  } catch (err) {
    return mcpError(err);
  }

  const { encrypted, iv } = await encryptCredentials(clientSecret ? { clientSecret } : {}, env.CREDENTIALS_KEY);
  const id = generateId('conn');
  await env.DB.prepare(`
    INSERT INTO connections (
      id, scope_type, scope_id, name, kind, provider, auth_type, config,
      encrypted_credentials, iv, created_by, credential_scope
    ) VALUES (?, 'workspace', ?, ?, 'platform', ?, ?, ?, ?, ?, ?, 'per_user')
  `).bind(
    id, workspaceId, body.name, MCP_PROVIDER, config.auth === 'oauth' ? 'oauth2' : 'none',
    JSON.stringify(config), encrypted, iv, user.id,
  ).run();

  await logAudit(env, {
    workspaceId,
    actorId: user.id,
    actorEmail: user.email,
    action: 'connection.created',
    targetType: 'connection',
    targetId: id,
    detail: { kind: 'platform', provider: MCP_PROVIDER, serverUrl, registration: config.oauth?.registration ?? 'none' },
  });

  return json({
    id,
    name: body.name,
    kind: 'platform',
    provider: MCP_PROVIDER,
    serverUrl,
    auth: config.auth,
    registration: config.oauth?.registration ?? null,
    credentialScope: 'per_user',
  }, 201);
}

// GET /v1/workspaces/{id}/connections/{connId}/mcp/connect — member starts OAuth
export async function handleMcpConnect(request: Request, env: Env, user: AuthUser, workspaceId: string, connectionId: string): Promise<Response> {
  if (!(await requireMember(env, workspaceId, user.id))) {
    return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }
  const conn = await loadMcpConnection(env, workspaceId, connectionId);
  if (!conn) return json({ error: 'Connection not found', code: 'NOT_FOUND' }, 404);
  if (conn.config.auth !== 'oauth' || !conn.config.oauth) {
    return json({ error: 'This MCP server does not need sign-in', code: 'NO_AUTH_REQUIRED' }, 400);
  }

  if (!env.RATE_LIMIT_KV) return json({ error: 'RATE_LIMIT_KV not configured', code: 'CONFIG_ERROR' }, 500);
  const url = new URL(request.url);
  const nonce = randomUrlSafe(16);
  const verifier = randomUrlSafe(32);
  await env.RATE_LIMIT_KV.put(pkceKey(nonce), verifier, { expirationTtl: PKCE_TTL_SECONDS });
  const state = await createOAuthState<ConnectState>(env, STATE_PURPOSE, user.id, {
    workspaceId,
    connectionId,
    nonce,
    returnUrl: sameOriginReturnUrl(url.searchParams.get('returnUrl'), url.origin),
  });
  return json({ authUrl: buildAuthorizeUrl(env, conn.config.oauth, state, await pkceChallenge(verifier)) });
}

// GET /v1/oauth/mcp/callback — fixed redirect URI (it is listed in the client metadata)
export async function handleMcpOAuthCallback(request: Request, env: Env, userId: string | null): Promise<Response> {
  const url = new URL(request.url);
  const denial = oauthDenialMessage(url);
  if (denial) return renderWorkspaceConnectionCallbackPage(false, MCP_PROVIDER, denial);

  const code = url.searchParams.get('code');
  const stateParam = url.searchParams.get('state');
  if (!code || !stateParam) return renderWorkspaceConnectionCallbackPage(false, MCP_PROVIDER, 'Missing code or state');

  const state = await verifyOAuthState<ConnectState>(env, stateParam, STATE_PURPOSE, userId);
  if (!state || !userId) {
    return renderWorkspaceConnectionCallbackPage(false, MCP_PROVIDER, 'Invalid or expired state. Start the connection again.');
  }
  if (!(await requireMember(env, state.workspaceId, userId))) {
    return renderWorkspaceConnectionCallbackPage(false, MCP_PROVIDER, 'You are not a member of this workspace');
  }
  const conn = await loadMcpConnection(env, state.workspaceId, state.connectionId);
  if (!conn?.config.oauth || !env.CREDENTIALS_KEY) {
    return renderWorkspaceConnectionCallbackPage(false, MCP_PROVIDER, 'Connection not found');
  }

  const verifier = await env.RATE_LIMIT_KV?.get(pkceKey(state.nonce));
  if (!verifier) return renderWorkspaceConnectionCallbackPage(false, MCP_PROVIDER, 'This sign-in link expired. Start the connection again.');
  await env.RATE_LIMIT_KV?.delete(pkceKey(state.nonce));

  try {
    const tokens = await exchangeCode(env, conn.config.oauth, conn.clientSecret, code, verifier);
    await saveUserConnectionCredentials(env, conn.id, userId, tokens as unknown as Record<string, unknown>, env.CREDENTIALS_KEY);
  } catch (err) {
    logError(
      createLogger(env, { scope: 'mcp-connections', event: 'mcp.oauth_callback.failed', workspace_id: state.workspaceId, connection: conn.name }),
      'mcp oauth callback failed',
      err,
    );
    return renderWorkspaceConnectionCallbackPage(false, MCP_PROVIDER, `Could not connect ${conn.name}. Try again.`);
  }

  try {
    await refreshMcpTools(env, conn, userId);
  } catch (err) {
    logError(
      createLogger(env, { scope: 'mcp-connections', event: 'mcp.tools_list.failed', workspace_id: state.workspaceId, connection: conn.name }),
      'mcp tools/list after connect failed',
      err,
    );
  }

  return renderWorkspaceConnectionCallbackPage(
    true,
    MCP_PROVIDER,
    `${conn.name} connected. You can close this window.`,
    sameOriginReturnUrl(state.returnUrl, url.origin) || undefined,
  );
}

// POST /v1/workspaces/{id}/connections/{connId}/mcp/tools — re-list tools with the caller's account
export async function handleRefreshMcpTools(env: Env, user: AuthUser, workspaceId: string, connectionId: string): Promise<Response> {
  if (!(await requireMember(env, workspaceId, user.id))) {
    return json({ error: 'Forbidden', code: 'FORBIDDEN' }, 403);
  }
  const conn = await loadMcpConnection(env, workspaceId, connectionId);
  if (!conn) return json({ error: 'Connection not found', code: 'NOT_FOUND' }, 404);
  try {
    const tools = await refreshMcpTools(env, conn, user.id);
    return json({ tools, toolsFetchedAt: conn.config.toolsFetchedAt });
  } catch (err) {
    if (err instanceof McpClientError && err.code === 'needs_auth') {
      return json({ error: `Connect ${conn.name} first`, code: 'CREDENTIALS_REQUIRED' }, 403);
    }
    return mcpError(err);
  }
}
