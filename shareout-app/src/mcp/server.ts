/**
 * POST /mcp — the remote MCP server (Streamable HTTP, stateless, JSON responses).
 *
 * Dual-era: answers the legacy `initialize` handshake (2025-11-25 and earlier) and the
 * stateless 2026-07-28 revision (`server/discover`, per-request `_meta`). No sessions,
 * no SSE stream, no Durable Object: every request stands alone and authenticates with
 * its own Bearer token, so GET/DELETE get 405.
 */
import type { Env } from '../types';
import { validateToken } from '../api-auth';
import { checkKVRateLimit } from '../rate-limit';
import { protectedResourceMetadataUrl, MCP_SCOPE } from './oauth';
import { SERVER_INSTRUCTIONS, callTool, listTools } from './tools';

export const SUPPORTED_PROTOCOL_VERSIONS = ['2026-07-28', '2025-11-25', '2025-06-18', '2025-03-26'];
const LEGACY_DEFAULT_VERSION = '2025-11-25';
const SERVER_INFO = { name: 'shareout', title: 'ShareOut', version: '1.0.0' };
const CAPABILITIES = { tools: { listChanged: false } };
const LIST_TTL_MS = 3_600_000;

const CORS = {
  // Bearer-only, no cookies: any origin may call it (claude.ai, chatgpt.com, inspectors).
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Session-Id, Mcp-Method, Mcp-Name, Last-Event-ID',
  'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id',
  'Access-Control-Max-Age': '86400',
};

type JsonRpcId = string | number | null;
interface JsonRpcRequest {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
}

function respond(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { ...(body === null ? {} : { 'Content-Type': 'application/json' }), 'Cache-Control': 'no-store', ...CORS, ...extra },
  });
}

function rpcResult(id: JsonRpcId, result: Record<string, unknown>) {
  return { jsonrpc: '2.0', id, result: { resultType: 'complete', _meta: { 'io.modelcontextprotocol/serverInfo': SERVER_INFO }, ...result } };
}

function rpcError(id: JsonRpcId, code: number, message: string, data?: unknown) {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

export function mcpPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

function unauthorized(origin: string, error?: 'invalid_token'): Response {
  const parts = [`resource_metadata="${protectedResourceMetadataUrl(origin)}"`, `scope="${MCP_SCOPE}"`];
  if (error) parts.unshift(`error="${error}"`);
  return respond(
    { error: 'Sign in to ShareOut to use this connector.' },
    401,
    { 'WWW-Authenticate': `Bearer ${parts.join(', ')}` },
  );
}

export async function handleMcp(request: Request, env: Env, origin: string, executionCtx?: ExecutionContext): Promise<Response> {
  if (request.method === 'OPTIONS') return mcpPreflight();
  if (request.method !== 'POST') return respond(null, 405, { Allow: 'POST, OPTIONS' });

  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) return unauthorized(origin);
  const user = await validateToken(request, env);
  if (!user) return unauthorized(origin, 'invalid_token');
  // Workspace Agent tokens carry their own scope model this surface does not map.
  if (user.service) return respond({ error: 'Workspace agent tokens cannot use the MCP connector; sign in as a person.' }, 403);

  const limit = await checkKVRateLimit(env.RATE_LIMIT_KV, user.id, 'mcp');
  if (!limit.allowed) {
    return respond({ error: 'Too many requests, try again shortly.' }, 429, { 'Retry-After': String(limit.retryAfter ?? 60) });
  }

  let msg: JsonRpcRequest;
  try {
    msg = await request.json();
  } catch {
    return respond(rpcError(null, -32700, 'Parse error'), 400);
  }
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0') {
    return respond(rpcError(null, -32600, 'Invalid Request'), 400);
  }
  // Notifications and client responses need no answer.
  if (msg.id === undefined || typeof msg.method !== 'string') return respond(null, 202);

  const id = msg.id;
  const params = (msg.params && typeof msg.params === 'object' ? msg.params : {}) as Record<string, unknown>;
  const meta = (params._meta ?? {}) as Record<string, unknown>;
  const requested = (meta['io.modelcontextprotocol/protocolVersion'] as string | undefined)
    ?? (msg.method === 'initialize' ? undefined : request.headers.get('MCP-Protocol-Version') ?? undefined);
  if (requested && !SUPPORTED_PROTOCOL_VERSIONS.includes(requested)) {
    return respond(rpcError(id, -32022, 'Unsupported protocol version', { supported: SUPPORTED_PROTOCOL_VERSIONS, requested }), 400);
  }

  switch (msg.method) {
    case 'initialize': {
      const asked = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
      return respond(rpcResult(id, {
        protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(asked) ? asked : LEGACY_DEFAULT_VERSION,
        capabilities: CAPABILITIES,
        serverInfo: SERVER_INFO,
        instructions: SERVER_INSTRUCTIONS,
      }));
    }
    case 'server/discover':
      return respond(rpcResult(id, {
        supportedVersions: SUPPORTED_PROTOCOL_VERSIONS,
        capabilities: CAPABILITIES,
        serverInfo: SERVER_INFO,
        instructions: SERVER_INSTRUCTIONS,
        ttlMs: LIST_TTL_MS,
        cacheScope: 'public',
      }));
    case 'ping':
      return respond(rpcResult(id, {}));
    case 'tools/list':
      return respond(rpcResult(id, { tools: listTools(), ttlMs: LIST_TTL_MS, cacheScope: 'public' }));
    case 'resources/list':
    case 'prompts/list':
      return respond(rpcResult(id, { [msg.method === 'resources/list' ? 'resources' : 'prompts']: [], ttlMs: LIST_TTL_MS, cacheScope: 'public' }));
    case 'tools/call': {
      const name = typeof params.name === 'string' ? params.name : '';
      const args = (params.arguments && typeof params.arguments === 'object' ? params.arguments : {}) as Record<string, unknown>;
      const result = await callTool({ env, user, origin, authorization, executionCtx }, name, args);
      if (!result) return respond(rpcError(id, -32602, `Unknown tool: ${name}`));
      return respond(rpcResult(id, result as unknown as Record<string, unknown>));
    }
    default:
      return respond(rpcError(id, -32601, `Method not found: ${msg.method}`));
  }
}
