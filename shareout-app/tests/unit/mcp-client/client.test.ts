import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';
import { McpClientError } from '../../../src/mcp-client/http';
import { callTool, listTools, openSession } from '../../../src/mcp-client/transport';
import { canonicalServerUri, discoverAuth, parseWwwAuthenticate } from '../../../src/mcp-client/discovery';
import { buildAuthorizeUrl, registerClient } from '../../../src/mcp-client/oauth';
import { installFakeServer, ISSUER, MCP_URL } from './fake-server';

const e = env as unknown as Env;

afterEach(() => vi.restoreAllMocks());

async function authed(fake: ReturnType<typeof installFakeServer>) {
  fake.state.validAccessTokens.add('good');
  return openSession(e, MCP_URL, 'good');
}

describe('transport', () => {
  it('initializes, then sends the session id and protocol version on later calls', async () => {
    const fake = installFakeServer();
    const session = await authed(fake);
    expect(session.sessionId).toBe('sess-1');
    await listTools(e, session);
    const later = fake.state.calls.filter((c) => c.url === MCP_URL).slice(1);
    expect(later.length).toBeGreaterThan(0);
    for (const c of later) {
      expect(c.headers.get('Mcp-Session-Id')).toBe('sess-1');
      expect(c.headers.get('MCP-Protocol-Version')).toBe('2025-11-25');
      expect(c.headers.get('Authorization')).toBe('Bearer good');
    }
  });

  it('follows tools/list pagination', async () => {
    const fake = installFakeServer();
    const tools = await listTools(e, await authed(fake));
    expect(tools.map((t) => t.name)).toEqual(['search', 'create_page']);
    expect(tools[0].annotations?.readOnlyHint).toBe(true);
  });

  it('reads the matching response out of an SSE stream', async () => {
    const fake = installFakeServer({ sse: true });
    const result = await callTool(e, await authed(fake), 'search', { q: 'x' });
    expect(result.structuredContent).toEqual({ ok: true, args: { q: 'x' } });
    expect(result.isError).toBe(false);
  });

  it('maps 401 to needs_auth and keeps the challenge', async () => {
    installFakeServer();
    const err = await openSession(e, MCP_URL, null).catch((x) => x);
    expect(err).toBeInstanceOf(McpClientError);
    expect(err.code).toBe('needs_auth');
    expect(err.detail.wwwAuthenticate).toContain('resource_metadata=');
  });

  it('refuses http, private, and own-instance destinations before any request', async () => {
    const fake = installFakeServer();
    for (const url of ['http://mcp.example.com/mcp', 'https://10.0.0.5/mcp', 'https://shareout.test/mcp', 'https://ws.shareout.test/mcp']) {
      const err = await openSession(e, url, null).catch((x) => x);
      expect(err.code, url).toBe('blocked_destination');
    }
    expect(fake.spy).not.toHaveBeenCalled();
  });
});

describe('discovery', () => {
  it('parses WWW-Authenticate parameters', () => {
    expect(parseWwwAuthenticate('Bearer resource_metadata="https://x/y", scope="a b"')).toEqual({
      resourceMetadata: 'https://x/y',
      scope: 'a b',
    });
  });

  it('canonicalizes server URIs', () => {
    expect(canonicalServerUri('HTTPS://MCP.Example.com/mcp/#frag')).toBe('https://mcp.example.com/mcp');
    expect(canonicalServerUri('https://mcp.example.com/')).toBe('https://mcp.example.com');
  });

  it('discovers from the 401 challenge, with challenge scopes', async () => {
    installFakeServer();
    const r = await discoverAuth(e, MCP_URL);
    expect(r).toEqual({
      auth: 'oauth',
      oauth: expect.objectContaining({
        issuer: ISSUER,
        tokenEndpoint: `${ISSUER}/token`,
        cimdSupported: true,
        scopes: ['read', 'write'],
        resource: MCP_URL,
      }),
    });
  });

  it('falls back to the well-known path when the challenge has no metadata URL', async () => {
    installFakeServer({ headerMetadata: false });
    const r = await discoverAuth(e, MCP_URL);
    expect(r.auth === 'oauth' && r.oauth.scopes).toEqual(['read']);
  });

  it('reports auth none when initialize succeeds without a token', async () => {
    installFakeServer({ requireAuth: false });
    expect(await discoverAuth(e, MCP_URL)).toEqual({ auth: 'none' });
  });

  it('refuses servers without S256 and metadata naming another origin', async () => {
    installFakeServer({ s256: false });
    expect((await discoverAuth(e, MCP_URL).catch((x) => x)).message).toMatch(/S256/);
    vi.restoreAllMocks();
    installFakeServer({ prmResource: 'https://other.example.com/mcp' });
    expect((await discoverAuth(e, MCP_URL).catch((x) => x)).message).toMatch(/different server/);
  });
});

describe('client registration', () => {
  it('uses the CIMD URL as client_id when the server supports it', async () => {
    installFakeServer();
    const r = await discoverAuth(e, MCP_URL);
    if (r.auth !== 'oauth') throw new Error('expected oauth');
    const { client } = await registerClient(e, r.oauth);
    expect(client).toMatchObject({ registration: 'cimd', clientId: 'https://shareout.test/oauth/mcp-client.json', tokenAuthMethod: 'none' });
  });

  it('falls back to dynamic registration', async () => {
    const fake = installFakeServer({ cimd: false });
    const r = await discoverAuth(e, MCP_URL);
    if (r.auth !== 'oauth') throw new Error('expected oauth');
    const { client } = await registerClient(e, r.oauth);
    expect(client).toMatchObject({ registration: 'dcr', clientId: 'dcr-client' });
    const reg = fake.state.calls.find((c) => c.url === `${ISSUER}/register`);
    expect(JSON.parse(reg!.body)).toMatchObject({
      redirect_uris: ['https://shareout.test/v1/oauth/mcp/callback'],
      token_endpoint_auth_method: 'none',
    });
  });

  it('fails clearly when neither is supported', async () => {
    installFakeServer({ cimd: false, dcr: false });
    const r = await discoverAuth(e, MCP_URL);
    if (r.auth !== 'oauth') throw new Error('expected oauth');
    expect((await registerClient(e, r.oauth).catch((x) => x)).code).toBe('registration_unsupported');
  });

  it('builds an authorize URL with PKCE S256, resource and scopes', async () => {
    installFakeServer();
    const r = await discoverAuth(e, MCP_URL);
    if (r.auth !== 'oauth') throw new Error('expected oauth');
    const { client } = await registerClient(e, r.oauth);
    const u = new URL(buildAuthorizeUrl(e, client, 'st', 'chal'));
    expect(u.origin + u.pathname).toBe(`${ISSUER}/authorize`);
    expect(Object.fromEntries(u.searchParams)).toMatchObject({
      response_type: 'code',
      code_challenge: 'chal',
      code_challenge_method: 'S256',
      state: 'st',
      resource: MCP_URL,
      scope: 'read write',
      redirect_uri: 'https://shareout.test/v1/oauth/mcp/callback',
    });
  });
});
