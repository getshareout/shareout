// A fake remote MCP server + OAuth authorization server behind a fetch mock.
import { vi } from 'vitest';

export const MCP_URL = 'https://mcp.example.com/mcp';
export const ISSUER = 'https://auth.example.com';

export interface FakeOptions {
  cimd?: boolean;
  dcr?: boolean;
  s256?: boolean;
  headerMetadata?: boolean;
  sse?: boolean;
  requireAuth?: boolean;
  prmResource?: string;
}

export interface FakeState {
  calls: { url: string; method: string; headers: Headers; body: string }[];
  tokenCalls: URLSearchParams[];
  challenges: Map<string, string>;
  refreshTokens: Map<string, string>;
  validAccessTokens: Set<string>;
  issued: number;
  sessionId: string;
}

async function sha256url(v: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v));
  return btoa(String.fromCharCode(...new Uint8Array(d))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

export function installFakeServer(opts: FakeOptions = {}) {
  const o = { cimd: true, dcr: true, s256: true, headerMetadata: true, sse: false, requireAuth: true, ...opts };
  const state: FakeState = {
    calls: [],
    tokenCalls: [],
    challenges: new Map(),
    refreshTokens: new Map(),
    validAccessTokens: new Set(),
    issued: 0,
    sessionId: 'sess-1',
  };

  const issue = (rotateFrom?: string) => {
    state.issued++;
    const at = `at${state.issued}`;
    const rt = `rt${state.issued}`;
    if (rotateFrom) state.refreshTokens.delete(rotateFrom);
    state.refreshTokens.set(rt, at);
    state.validAccessTokens.add(at);
    return { access_token: at, refresh_token: rt, expires_in: 3600, token_type: 'Bearer' };
  };

  const rpc = (id: unknown, result: unknown, extra: Record<string, string> = {}) => {
    const message = { jsonrpc: '2.0', id, result };
    if (o.sse) {
      const body = `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: {} })}\n\n`
        + `event: message\ndata: ${JSON.stringify(message)}\n\n`;
      return new Response(body, { headers: { 'Content-Type': 'text/event-stream', ...extra } });
    }
    return json(message, 200, extra);
  };

  const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method || 'GET').toUpperCase();
    const headers = new Headers(init?.headers);
    const body = typeof init?.body === 'string' ? init.body : '';
    state.calls.push({ url, method, headers, body });

    if (url === MCP_URL && method === 'POST') {
      const auth = headers.get('Authorization');
      const token = auth?.replace(/^Bearer /, '');
      if (o.requireAuth && (!token || !state.validAccessTokens.has(token))) {
        const params = o.headerMetadata
          ? `resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp", scope="read write"`
          : 'realm="mcp"';
        return new Response('unauthorized', { status: 401, headers: { 'WWW-Authenticate': `Bearer ${params}` } });
      }
      const msg = JSON.parse(body) as { id?: number; method: string; params?: Record<string, unknown> };
      if (msg.method === 'initialize') {
        return rpc(msg.id, { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'fake' } }, { 'Mcp-Session-Id': state.sessionId });
      }
      if (headers.get('Mcp-Session-Id') !== state.sessionId) return new Response('no session', { status: 400 });
      if (msg.method === 'notifications/initialized') return new Response(null, { status: 202 });
      if (msg.method === 'tools/list') {
        return msg.params?.cursor
          ? rpc(msg.id, { tools: [{ name: 'create_page', annotations: { readOnlyHint: false } }] })
          : rpc(msg.id, { tools: [{ name: 'search', description: 'Search', annotations: { readOnlyHint: true } }], nextCursor: 'p2' });
      }
      if (msg.method === 'tools/call') {
        return rpc(msg.id, { content: [{ type: 'text', text: '{"ok":true}' }], structuredContent: { ok: true, args: msg.params?.arguments } });
      }
      return json({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
    }

    if (url === 'https://mcp.example.com/.well-known/oauth-protected-resource/mcp') {
      return json({ resource: o.prmResource ?? MCP_URL, authorization_servers: [ISSUER], scopes_supported: ['read'] });
    }
    if (url === 'https://mcp.example.com/.well-known/oauth-protected-resource') return json({}, 404);
    if (url === `${ISSUER}/.well-known/oauth-authorization-server`) {
      return json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
        ...(o.dcr ? { registration_endpoint: `${ISSUER}/register` } : {}),
        code_challenge_methods_supported: o.s256 ? ['S256'] : ['plain'],
        ...(o.cimd ? { client_id_metadata_document_supported: true } : {}),
      });
    }
    if (url === `${ISSUER}/register` && method === 'POST') return json({ client_id: 'dcr-client' }, 201);
    if (url === `${ISSUER}/token` && method === 'POST') {
      const form = new URLSearchParams(body);
      state.tokenCalls.push(form);
      if (!form.get('resource')) return json({ error: 'invalid_target' }, 400);
      if (form.get('grant_type') === 'authorization_code') {
        const challenge = state.challenges.get(form.get('code') || '');
        if (!challenge || challenge !== (await sha256url(form.get('code_verifier') || ''))) {
          return json({ error: 'invalid_grant' }, 400);
        }
        return json(issue());
      }
      if (form.get('grant_type') === 'refresh_token') {
        const rt = form.get('refresh_token') || '';
        if (!state.refreshTokens.has(rt)) return json({ error: 'invalid_grant' }, 400);
        return json(issue(rt));
      }
    }
    return new Response('not found', { status: 404 });
  };

  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(handler as typeof fetch);
  return {
    state,
    spy,
    /** Simulate the user approving at the authorize endpoint: bind a code to the PKCE challenge. */
    approve(authUrl: string): { code: string; state: string } {
      const u = new URL(authUrl);
      const code = `code-${state.challenges.size + 1}`;
      state.challenges.set(code, u.searchParams.get('code_challenge') || '');
      return { code, state: u.searchParams.get('state') || '' };
    },
  };
}
