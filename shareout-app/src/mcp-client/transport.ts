/**
 * Minimal MCP client over Streamable HTTP: initialize → notifications/initialized →
 * tools/list | tools/call. Responses may be plain JSON or an SSE stream; the
 * stream is read only until the matching response arrives.
 */
import type { Env } from '../types';
import { guardedFetch, McpClientError, MCP_MAX_RESPONSE_BYTES, readCappedText } from './http';

export const MCP_PROTOCOL_VERSION = '2025-11-25';
const CLIENT_INFO = { name: 'ShareOut', version: '1.0.0' };
const MAX_TOOL_PAGES = 10;

export interface McpSession {
  serverUrl: string;
  token: string | null;
  sessionId?: string;
  protocolVersion: string;
  nextId: number;
}

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
}

export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  annotations?: ToolAnnotations;
}

export interface CallToolResult {
  content: unknown[];
  structuredContent?: unknown;
  isError?: boolean;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id?: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export class McpSessionExpiredError extends McpClientError {
  constructor() {
    super('server_unavailable', 'MCP session expired');
    this.name = 'McpSessionExpiredError';
  }
}

async function post(env: Env, session: McpSession, message: Record<string, unknown>): Promise<Response> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  if (session.sessionId) headers['Mcp-Session-Id'] = session.sessionId;
  if (message.method !== 'initialize') headers['MCP-Protocol-Version'] = session.protocolVersion;

  const res = await guardedFetch(env, session.serverUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', ...message }),
  });

  if (res.status === 401 || res.status === 403) {
    await res.body?.cancel();
    throw new McpClientError('needs_auth', `MCP server returned ${res.status}`, {
      status: res.status,
      wwwAuthenticate: res.headers.get('WWW-Authenticate'),
    });
  }
  if (res.status === 404 && session.sessionId) {
    await res.body?.cancel();
    throw new McpSessionExpiredError();
  }
  if (res.status === 429 || res.status >= 500) {
    await res.body?.cancel();
    throw new McpClientError('server_unavailable', `MCP server returned ${res.status}`, { status: res.status });
  }
  if (!res.ok && res.status !== 202) {
    const text = await readCappedText(res).catch(() => '');
    throw new McpClientError('bad_response', `MCP server returned ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`, { status: res.status });
  }
  return res;
}

function pickResponse(candidate: unknown, id: number): JsonRpcResponse | null {
  const list = Array.isArray(candidate) ? candidate : [candidate];
  for (const item of list) {
    if (item && typeof item === 'object' && (item as JsonRpcResponse).id === id && ('result' in item || 'error' in item)) {
      return item as JsonRpcResponse;
    }
  }
  return null;
}

async function readSseResponse(res: Response, id: number): Promise<JsonRpcResponse> {
  if (!res.body) throw new McpClientError('bad_response', 'Empty event stream');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) {
        total += value.byteLength;
        if (total > MCP_MAX_RESPONSE_BYTES) throw new McpClientError('bad_response', 'Response too large');
        buffer += decoder.decode(value, { stream: true });
      }
      buffer = buffer.replace(/\r\n/g, '\n');
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const event = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const data = event
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).replace(/^ /, ''))
          .join('\n');
        if (!data) continue;
        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }
        const match = pickResponse(parsed, id);
        if (match) return match;
      }
      if (done) break;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  throw new McpClientError('bad_response', 'Event stream ended without a response');
}

async function request<T>(env: Env, session: McpSession, method: string, params?: unknown): Promise<{ result: T; res: Response }> {
  const id = session.nextId++;
  const res = await post(env, session, { id, method, ...(params === undefined ? {} : { params }) });
  const type = res.headers.get('Content-Type') || '';
  let message: JsonRpcResponse | null;
  if (type.includes('text/event-stream')) {
    message = await readSseResponse(res, id);
  } else {
    const text = await readCappedText(res);
    try {
      message = pickResponse(JSON.parse(text), id);
    } catch {
      message = null;
    }
  }
  if (!message) throw new McpClientError('bad_response', `No JSON-RPC response for ${method}`);
  if (message.error) throw new McpClientError('rpc_error', message.error.message || `${method} failed`);
  return { result: message.result as T, res };
}

export async function openSession(env: Env, serverUrl: string, token: string | null): Promise<McpSession> {
  const session: McpSession = { serverUrl, token, protocolVersion: MCP_PROTOCOL_VERSION, nextId: 1 };
  const { result, res } = await request<{ protocolVersion?: string }>(env, session, 'initialize', {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: CLIENT_INFO,
  });
  session.sessionId = res.headers.get('Mcp-Session-Id') || undefined;
  if (result?.protocolVersion) session.protocolVersion = result.protocolVersion;
  const ack = await post(env, session, { method: 'notifications/initialized' });
  await ack.body?.cancel();
  return session;
}

export async function listTools(env: Env, session: McpSession): Promise<ToolInfo[]> {
  const tools: ToolInfo[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_TOOL_PAGES; page++) {
    const { result } = await request<{ tools?: ToolInfo[]; nextCursor?: string }>(
      env,
      session,
      'tools/list',
      cursor ? { cursor } : undefined,
    );
    for (const t of result?.tools ?? []) {
      if (t && typeof t.name === 'string') tools.push(t);
    }
    cursor = result?.nextCursor;
    if (!cursor) break;
  }
  return tools;
}

export async function callTool(env: Env, session: McpSession, name: string, args: unknown): Promise<CallToolResult> {
  const { result } = await request<CallToolResult>(env, session, 'tools/call', { name, arguments: args ?? {} });
  return { content: Array.isArray(result?.content) ? result.content : [], structuredContent: result?.structuredContent, isError: result?.isError === true };
}
