/**
 * OAuth client side of MCP connections: client registration (CIMD, else dynamic
 * registration), the authorize URL, code exchange, and per-member token refresh.
 */
import type { Env } from '../types';
import { getPlatformOrigin } from '../config/origins';
import { encryptCredentials, decryptCredentials } from '../data/connections/credentials';
import { fetchJson, McpClientError } from './http';
import type { McpAuthConfig } from './discovery';
import type { ToolInfo } from './transport';

export type TokenAuthMethod = 'none' | 'client_secret_post' | 'client_secret_basic';

export interface McpOAuthClient extends McpAuthConfig {
  clientId: string;
  registration: 'cimd' | 'dcr';
  tokenAuthMethod: TokenAuthMethod;
}

export interface McpConnectionConfig {
  serverUrl: string;
  auth: 'none' | 'oauth';
  oauth?: McpOAuthClient;
  tools?: ToolInfo[];
  toolsFetchedAt?: string;
}

export interface McpMemberTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
}

const REFRESH_SKEW_MS = 60_000;
const REFRESH_WAIT_MS = 5_000;
const REFRESH_POLL_MS = 250;

export const mcpClientMetadataUrl = (env: Env) => `${getPlatformOrigin(env)}/oauth/mcp-client.json`;
export const mcpRedirectUri = (env: Env) => `${getPlatformOrigin(env)}/v1/oauth/mcp/callback`;

/** CIMD needs the authorization server to fetch our document, so only a public https origin qualifies. */
function canServeCimd(env: Env): boolean {
  const u = new URL(getPlatformOrigin(env));
  return u.protocol === 'https:' && u.hostname !== 'localhost';
}

export function clientMetadataDocument(env: Env): Record<string, unknown> {
  return {
    client_id: mcpClientMetadataUrl(env),
    client_name: 'ShareOut',
    client_uri: getPlatformOrigin(env),
    redirect_uris: [mcpRedirectUri(env)],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
  };
}

export async function registerClient(
  env: Env,
  oauth: McpAuthConfig,
): Promise<{ client: McpOAuthClient; clientSecret?: string }> {
  if (oauth.cimdSupported && canServeCimd(env)) {
    return { client: { ...oauth, clientId: mcpClientMetadataUrl(env), registration: 'cimd', tokenAuthMethod: 'none' } };
  }
  if (!oauth.registrationEndpoint) {
    throw new McpClientError(
      'registration_unsupported',
      'This server supports neither Client ID Metadata Documents nor dynamic client registration',
    );
  }
  const { status, body } = await fetchJson<{ client_id?: string; client_secret?: string; token_endpoint_auth_method?: string }>(
    env,
    oauth.registrationEndpoint,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'ShareOut',
        client_uri: getPlatformOrigin(env),
        redirect_uris: [mcpRedirectUri(env)],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        ...(oauth.scopes.length ? { scope: oauth.scopes.join(' ') } : {}),
      }),
    },
  );
  if ((status !== 200 && status !== 201) || !body?.client_id) {
    throw new McpClientError('bad_response', `Dynamic client registration failed (${status})`);
  }
  const method = body.token_endpoint_auth_method as TokenAuthMethod | undefined;
  const tokenAuthMethod: TokenAuthMethod = body.client_secret
    ? (method === 'client_secret_post' ? 'client_secret_post' : 'client_secret_basic')
    : 'none';
  return {
    client: { ...oauth, clientId: body.client_id, registration: 'dcr', tokenAuthMethod },
    clientSecret: body.client_secret,
  };
}

export function buildAuthorizeUrl(env: Env, client: McpOAuthClient, state: string, codeChallenge: string): string {
  const url = new URL(client.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', client.clientId);
  url.searchParams.set('redirect_uri', mcpRedirectUri(env));
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  url.searchParams.set('resource', client.resource);
  if (client.scopes.length) url.searchParams.set('scope', client.scopes.join(' '));
  return url.toString();
}

async function tokenRequest(
  env: Env,
  client: McpOAuthClient,
  clientSecret: string | undefined,
  params: Record<string, string>,
): Promise<McpMemberTokens> {
  const form = new URLSearchParams({ ...params, resource: client.resource });
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (client.tokenAuthMethod === 'client_secret_basic' && clientSecret) {
    headers.Authorization = `Basic ${btoa(`${encodeURIComponent(client.clientId)}:${encodeURIComponent(clientSecret)}`)}`;
  } else {
    form.set('client_id', client.clientId);
    if (client.tokenAuthMethod === 'client_secret_post' && clientSecret) form.set('client_secret', clientSecret);
  }
  const { status, body } = await fetchJson<{
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
  }>(env, client.tokenEndpoint, { method: 'POST', headers, body: form.toString() });
  if (status !== 200 || !body?.access_token) {
    if (body?.error === 'invalid_grant') throw new McpClientError('needs_auth', 'Grant expired or revoked');
    if (status >= 500) throw new McpClientError('server_unavailable', `Token endpoint returned ${status}`);
    throw new McpClientError('bad_response', `Token request failed (${status}${body?.error ? `: ${body.error}` : ''})`);
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token ?? params.refresh_token,
    expiresAt: typeof body.expires_in === 'number' ? Date.now() + body.expires_in * 1000 : undefined,
    scope: body.scope,
  };
}

export function exchangeCode(env: Env, client: McpOAuthClient, clientSecret: string | undefined, code: string, verifier: string) {
  return tokenRequest(env, client, clientSecret, {
    grant_type: 'authorization_code',
    code,
    redirect_uri: mcpRedirectUri(env),
    code_verifier: verifier,
  });
}

// ── per-member tokens ──────────────────────────────────────────────────────

interface CredentialRow {
  encrypted_credentials: string;
  iv: string;
  updated_at: string;
}

async function readRow(env: Env, connectionId: string, userId: string): Promise<CredentialRow | null> {
  return env.DB.prepare(
    'SELECT encrypted_credentials, iv, updated_at FROM connection_user_credentials WHERE connection_id = ? AND user_id = ?',
  ).bind(connectionId, userId).first<CredentialRow>();
}

const fresh = (t: McpMemberTokens) => !t.expiresAt || t.expiresAt - Date.now() > REFRESH_SKEW_MS;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The member's access token, refreshed when it is about to expire. Refreshes are
 * serialized with a compare-and-swap on `updated_at`: concurrent callers must not
 * spend the same rotating refresh token, which can revoke the whole grant.
 */
export async function getMemberAccessToken(
  env: Env,
  connectionId: string,
  userId: string,
  client: McpOAuthClient,
  clientSecret: string | undefined,
): Promise<string> {
  const key = env.CREDENTIALS_KEY;
  if (!key) throw new Error('CREDENTIALS_KEY not configured');
  const deadline = Date.now() + REFRESH_WAIT_MS;

  for (;;) {
    const row = await readRow(env, connectionId, userId);
    if (!row) throw new McpClientError('needs_auth', 'Not connected');
    const tokens = (await decryptCredentials(row.encrypted_credentials, row.iv, key)) as unknown as McpMemberTokens;
    if (fresh(tokens)) return tokens.accessToken;
    if (!tokens.refreshToken) throw new McpClientError('needs_auth', 'Access token expired');

    // Strictly later than the value it replaces: a same-millisecond claim would leave
    // updated_at unchanged and let a second caller win the swap too.
    const claim = new Date(Math.max(Date.now(), Date.parse(row.updated_at) + 1)).toISOString();
    const claimed = await env.DB.prepare(
      'UPDATE connection_user_credentials SET updated_at = ? WHERE connection_id = ? AND user_id = ? AND updated_at = ?',
    ).bind(claim, connectionId, userId, row.updated_at).run();

    if ((claimed.meta.changes ?? 0) === 0) {
      if (Date.now() > deadline) throw new McpClientError('server_unavailable', 'Token refresh in progress');
      await sleep(REFRESH_POLL_MS);
      continue;
    }

    let next: McpMemberTokens;
    try {
      next = await tokenRequest(env, client, clientSecret, { grant_type: 'refresh_token', refresh_token: tokens.refreshToken });
    } catch (err) {
      if (err instanceof McpClientError && err.code === 'needs_auth') {
        await env.DB.prepare(
          'DELETE FROM connection_user_credentials WHERE connection_id = ? AND user_id = ? AND updated_at = ?',
        ).bind(connectionId, userId, claim).run();
      }
      throw err;
    }
    const { encrypted, iv } = await encryptCredentials(next as unknown as Record<string, unknown>, key);
    await env.DB.prepare(
      `UPDATE connection_user_credentials SET encrypted_credentials = ?, iv = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE connection_id = ? AND user_id = ? AND updated_at = ?`,
    ).bind(encrypted, iv, connectionId, userId, claim).run();
    return next.accessToken;
  }
}
