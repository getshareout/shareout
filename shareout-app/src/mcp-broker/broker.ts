/**
 * MCP broker: `/v1/data/{artifactId}/mcp/{list|call}`. A page calls its viewer's
 * MCP connections here. Handled before the data middleware: the only credential
 * accepted is the short-lived broker token, never the artifact data token.
 *
 * Order of checks on a call: token → page gate (member, members-only page, live
 * declaration) → token bound to the current declaration → declared connection and
 * tool → tool is read-only → viewer allowed this page → rate limit → tool call.
 */
import type { Env } from '../types';
import { corsHeaders } from '../data/middleware';
import { buildApiErrorBody } from '../http/api-error';
import { checkKVRateLimit } from '../rate-limit';
import { isFeatureEnabled } from '../features/flags';
import { createLogger, logError } from '../logging';
import { hasUserConnectionCredentials } from '../data/connections/user-credentials';
import { McpClientError } from '../mcp-client/http';
import { callMemberTool, loadMcpConnectionByName, refreshMcpTools, type McpConnection } from '../mcp-client/connection';
import type { ToolInfo } from '../mcp-client/transport';
import { resolveMcpPage, type McpPageContext } from './gate';
import { verifyMcpToken } from './token';

const MAX_INPUT_BYTES = 1024 * 1024;

export type BrokerErrorCode =
  | 'token_invalid'
  | 'token_stale'
  | 'sign_in_required'
  | 'not_found'
  | 'mcp_not_available'
  | 'not_allowed'
  | 'not_in_manifest'
  | 'server_not_connected'
  | 'not_read_only'
  | 'approval_required'
  | 'credentials_required'
  | 'needs_reauth'
  | 'tool_error'
  | 'server_unavailable'
  | 'rate_limited'
  | 'bad_request'
  | 'upstream_error';

const STATUS: Record<BrokerErrorCode, number> = {
  token_invalid: 401,
  token_stale: 401,
  sign_in_required: 401,
  not_found: 404,
  mcp_not_available: 403,
  not_allowed: 403,
  not_in_manifest: 403,
  server_not_connected: 404,
  not_read_only: 403,
  approval_required: 403,
  credentials_required: 403,
  needs_reauth: 403,
  tool_error: 422,
  server_unavailable: 503,
  rate_limited: 429,
  bad_request: 400,
  upstream_error: 502,
};

const RETRYABLE = new Set<BrokerErrorCode>(['server_unavailable', 'rate_limited']);

function fail(origin: string | null, code: BrokerErrorCode, message: string, extra: Record<string, unknown> = {}): Response {
  const body = { ...buildApiErrorBody({ code, message }), ...(RETRYABLE.has(code) ? { retryable: true } : {}), ...extra };
  return Response.json(body, { status: STATUS[code], headers: corsHeaders(origin) });
}

function ok(origin: string | null, data: unknown): Response {
  return Response.json({ success: true, data }, { headers: corsHeaders(origin) });
}

async function allowedConnectionIds(env: Env, page: McpPageContext, userId: string): Promise<Set<string>> {
  const { results } = await env.DB.prepare(
    'SELECT connection_id FROM artifact_mcp_consents WHERE artifact_id = ? AND user_id = ? AND capability_hash = ?',
  ).bind(page.artifactId, userId, page.capabilityHash).all<{ connection_id: string }>();
  return new Set(results.map((r) => r.connection_id));
}

function toolInfo(conn: McpConnection, name: string): ToolInfo | undefined {
  return conn.config.tools?.find((t) => t.name === name);
}

async function handleList(env: Env, origin: string | null, page: McpPageContext, userId: string): Promise<Response> {
  const allowed = await allowedConnectionIds(env, page, userId);
  const connections = await Promise.all(page.capability.connections.map(async (declared) => {
    const conn = await loadMcpConnectionByName(env, page.workspaceId, declared.name);
    if (!conn) return { name: declared.name, available: false, tools: [] };
    const connected = conn.config.auth === 'none' || await hasUserConnectionCredentials(env, conn.id, userId);
    return {
      name: declared.name,
      available: true,
      connected,
      allowed: allowed.has(conn.id),
      tools: declared.tools.map((name) => {
        const info = toolInfo(conn, name);
        return { name, description: info?.description ?? '', readOnly: info?.annotations?.readOnlyHint === true };
      }),
    };
  }));
  return ok(origin, { connections });
}

async function handleCall(env: Env, request: Request, origin: string | null, page: McpPageContext, userId: string): Promise<Response> {
  const text = await request.text();
  if (text.length > MAX_INPUT_BYTES) return fail(origin, 'bad_request', 'Input is larger than 1 MiB');
  let body: { connection?: unknown; tool?: unknown; input?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return fail(origin, 'bad_request', 'Body must be JSON: { connection, tool, input }');
  }
  if (typeof body.connection !== 'string' || typeof body.tool !== 'string') {
    return fail(origin, 'bad_request', 'connection and tool are required strings');
  }
  const connectionName = body.connection;
  const toolName = body.tool;

  const declared = page.capability.connections.find((c) => c.name === connectionName);
  if (!declared?.tools.includes(toolName)) {
    return fail(origin, 'not_in_manifest', `This page did not declare ${connectionName}.${toolName}`);
  }
  const conn = await loadMcpConnectionByName(env, page.workspaceId, connectionName);
  if (!conn) return fail(origin, 'server_not_connected', `No MCP connection named ${connectionName} in this workspace`);

  const connected = conn.config.auth === 'none' || await hasUserConnectionCredentials(env, conn.id, userId);
  if (!connected) return fail(origin, 'credentials_required', `Connect ${connectionName} to use this page`, { connection: connectionName });

  if (!(await allowedConnectionIds(env, page, userId)).has(conn.id)) {
    return fail(origin, 'approval_required', `Allow this page to use ${connectionName}`, { connection: connectionName });
  }

  try {
    if (!toolInfo(conn, toolName)) await refreshMcpTools(env, conn, userId);
    if (toolInfo(conn, toolName)?.annotations?.readOnlyHint !== true) {
      return fail(origin, 'not_read_only', `${connectionName}.${toolName} is not marked read-only; only read-only tools can be called from a page`);
    }

    const rate = await checkKVRateLimit(env.RATE_LIMIT_KV, `${userId}:${page.artifactId}`, 'mcpBroker');
    if (!rate.allowed) return fail(origin, 'rate_limited', 'Too many MCP calls from this page', { retryAfterMs: (rate.retryAfter ?? 60) * 1000 });

    const started = Date.now();
    const result = await callMemberTool(env, conn, userId, toolName, body.input ?? {});
    createLogger(env, { scope: 'mcp-broker' }).info('mcp.tool_call', {
      artifact_id: page.artifactId,
      connection: connectionName,
      tool: toolName,
      outcome: result.isError ? 'tool_error' : 'ok',
      ms: Date.now() - started,
    });
    if (result.isError) return fail(origin, 'tool_error', `${connectionName}.${toolName} reported an error`, { result });
    return ok(origin, result);
  } catch (err) {
    if (err instanceof McpClientError) {
      if (err.code === 'needs_auth') return fail(origin, 'needs_reauth', `Reconnect ${connectionName}`, { connection: connectionName });
      if (err.code === 'server_unavailable') return fail(origin, 'server_unavailable', `${connectionName} is not responding`);
      return fail(origin, 'upstream_error', `${connectionName}: ${err.message}`);
    }
    logError(createLogger(env, { scope: 'mcp-broker', artifact_id: page.artifactId }), 'mcp broker call failed', err);
    return fail(origin, 'upstream_error', 'The call failed');
  }
}

export async function handleMcpBroker(request: Request, env: Env, artifactId: string, action: string, origin: string | null): Promise<Response> {
  const auth = request.headers.get('Authorization');
  const token = await verifyMcpToken(env, auth?.startsWith('Bearer ') ? auth.slice(7) : null, artifactId);
  if (!token) return fail(origin, 'token_invalid', 'Missing or expired MCP token; ask the page host for a new one');

  const user = await env.DB.prepare('SELECT id, email FROM users WHERE id = ?').bind(token.u).first<{ id: string; email: string | null }>();
  if (!user) return fail(origin, 'sign_in_required', 'Sign in to use this page');

  const page = await resolveMcpPage(env, artifactId, user);
  if (page === 'not_found') return fail(origin, 'not_found', 'Artifact not found');
  if (page === 'not_available') return fail(origin, 'mcp_not_available', 'MCP connections are not available on this page');
  if (page === 'not_allowed') return fail(origin, 'not_allowed', 'Only members of this workspace can use its MCP connections');
  if (page.capabilityHash !== token.h) return fail(origin, 'token_stale', 'The page changed; ask the page host for a new MCP token');

  if (!(await isFeatureEnabled(env, 'integ.data_platform', page.workspaceId))) {
    return fail(origin, 'mcp_not_available', 'Connectors are turned off for this workspace');
  }

  if (action === 'list' && request.method === 'GET') return handleList(env, origin, page, user.id);
  if (action === 'call' && request.method === 'POST') return handleCall(env, request, origin, page, user.id);
  return fail(origin, 'bad_request', 'Use GET mcp/list or POST mcp/call');
}
