/**
 * MCP connections are workspace `connections` rows: kind 'platform', provider 'mcp',
 * credential_scope 'per_user'. `config` holds the server URL, the discovered OAuth
 * client and the last tool list; `encrypted_credentials` holds the client secret when
 * dynamic registration issued one; each member's tokens live in
 * `connection_user_credentials`.
 */
import type { Env } from '../types';
import { decryptCredentials } from '../data/connections/credentials';
import { McpClientError } from './http';
import { getMemberAccessToken, type McpConnectionConfig } from './oauth';
import { callTool, listTools, McpSessionExpiredError, openSession, type CallToolResult, type McpSession, type ToolInfo } from './transport';

export const MCP_PROVIDER = 'mcp';

export interface McpConnection {
  id: string;
  name: string;
  workspaceId: string;
  config: McpConnectionConfig;
  clientSecret?: string;
}

interface Row {
  id: string;
  name: string;
  scope_id: string;
  config: string;
  encrypted_credentials: string | null;
  iv: string | null;
}

async function hydrate(env: Env, row: Row | null): Promise<McpConnection | null> {
  if (!row) return null;
  let clientSecret: string | undefined;
  if (row.encrypted_credentials && row.iv && env.CREDENTIALS_KEY) {
    const secret = await decryptCredentials(row.encrypted_credentials, row.iv, env.CREDENTIALS_KEY);
    clientSecret = typeof secret.clientSecret === 'string' ? secret.clientSecret : undefined;
  }
  return { id: row.id, name: row.name, workspaceId: row.scope_id, config: JSON.parse(row.config) as McpConnectionConfig, clientSecret };
}

const SELECT = `SELECT id, name, scope_id, config, encrypted_credentials, iv FROM connections
  WHERE scope_type = 'workspace' AND kind = 'platform' AND provider = 'mcp'`;

export async function loadMcpConnection(env: Env, workspaceId: string, connectionId: string): Promise<McpConnection | null> {
  return hydrate(env, await env.DB.prepare(`${SELECT} AND scope_id = ? AND id = ?`).bind(workspaceId, connectionId).first<Row>());
}

export async function loadMcpConnectionByName(env: Env, workspaceId: string, name: string): Promise<McpConnection | null> {
  return hydrate(env, await env.DB.prepare(`${SELECT} AND scope_id = ? AND name = ?`).bind(workspaceId, name).first<Row>());
}

export async function openMemberSession(env: Env, conn: McpConnection, userId: string): Promise<McpSession> {
  if (conn.config.auth === 'none') return openSession(env, conn.config.serverUrl, null);
  if (!conn.config.oauth) throw new McpClientError('needs_auth', 'Connection has no OAuth client');
  const token = await getMemberAccessToken(env, conn.id, userId, conn.config.oauth, conn.clientSecret);
  return openSession(env, conn.config.serverUrl, token);
}

/** Re-list the server's tools with this member's session and store them on the connection. */
export async function refreshMcpTools(env: Env, conn: McpConnection, userId: string): Promise<ToolInfo[]> {
  const session = await openMemberSession(env, conn, userId);
  const tools = (await listTools(env, session)).map(({ name, description, inputSchema, outputSchema, annotations }) => ({
    name,
    description,
    inputSchema,
    outputSchema,
    annotations,
  }));
  const config: McpConnectionConfig = { ...conn.config, tools, toolsFetchedAt: new Date().toISOString() };
  await env.DB.prepare(
    `UPDATE connections SET config = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
  ).bind(JSON.stringify(config), conn.id).run();
  conn.config = config;
  return tools;
}

const SESSION_TTL_SECONDS = 10 * 60;
const sessionKey = (conn: McpConnection, userId: string) => `mcp-sess:${conn.id}:${userId}`;

/**
 * Call one tool as this member, reusing the server session across requests so a
 * dashboard does not pay initialize + initialized on every call.
 */
export async function callMemberTool(env: Env, conn: McpConnection, userId: string, tool: string, args: unknown): Promise<CallToolResult> {
  const token = conn.config.auth === 'none' || !conn.config.oauth
    ? null
    : await getMemberAccessToken(env, conn.id, userId, conn.config.oauth, conn.clientSecret);
  const kv = env.RATE_LIMIT_KV;
  const cached = await kv?.get<{ sessionId?: string; protocolVersion: string }>(sessionKey(conn, userId), 'json');
  if (cached) {
    const session: McpSession = { serverUrl: conn.config.serverUrl, token, sessionId: cached.sessionId, protocolVersion: cached.protocolVersion, nextId: 1 };
    try {
      return await callTool(env, session, tool, args);
    } catch (err) {
      const stale = err instanceof McpSessionExpiredError || (err instanceof McpClientError && err.code === 'bad_response' && err.detail?.status === 400);
      if (!stale) throw err;
    }
  }
  const session = await openSession(env, conn.config.serverUrl, token);
  await kv?.put(sessionKey(conn, userId), JSON.stringify({ sessionId: session.sessionId, protocolVersion: session.protocolVersion }), { expirationTtl: SESSION_TTL_SECONDS });
  return callTool(env, session, tool, args);
}
