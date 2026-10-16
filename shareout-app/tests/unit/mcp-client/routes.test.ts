import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../../src/api-auth';
import { applyMigrations, e } from '../helpers/migrated-db';
import {
  handleCreateMcpConnection,
  handleMcpClientMetadata,
  handleMcpConnect,
  handleMcpOAuthCallback,
  handleRefreshMcpTools,
} from '../../../src/router/api/workspace-connections/mcp';
import { loadMcpConnection } from '../../../src/mcp-client/connection';
import { handleWorkspaceConnectorsCatalog } from '../../../src/router/api/workspace-connections/list';
import { getMemberAccessToken } from '../../../src/mcp-client/oauth';
import { encryptCredentials } from '../../../src/data/connections/credentials';
import { installFakeServer, MCP_URL } from './fake-server';
import worker from '../../../src/index';

const WS = 'wsp_mcp';
const admin: AuthUser = { id: 'usr_mcp_admin', email: 'admin@x.test', username: null };
const member: AuthUser = { id: 'usr_mcp_member', email: 'member@x.test', username: null };
const outsider: AuthUser = { id: 'usr_mcp_out', email: 'out@x.test', username: null };
const KEY = 'test-key-32-chars-long-enough!!!';

beforeAll(async () => {
  await applyMigrations();
  (e as { CREDENTIALS_KEY?: string }).CREDENTIALS_KEY = KEY;
  await e.DB.batch([
    ...[admin, member, outsider].map((u) => e.DB.prepare('INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)').bind(u.id, u.email)),
    e.DB.prepare('INSERT OR IGNORE INTO workspaces (id, name, slug, owner_id) VALUES (?, ?, ?, ?)').bind(WS, 'MCP', 'mcp-ws', admin.id),
    e.DB.prepare(`INSERT OR IGNORE INTO workspace_members (id, workspace_id, user_id, role) VALUES ('wm_mcp_1', ?, ?, 'admin'), ('wm_mcp_2', ?, ?, 'member')`)
      .bind(WS, admin.id, WS, member.id),
  ]);
});

beforeEach(async () => {
  await e.DB.prepare("DELETE FROM connections WHERE scope_id = ?").bind(WS).run();
});

afterEach(() => vi.restoreAllMocks());

const req = (path: string, init?: RequestInit) => new Request(`https://shareout.test${path}`, init);

async function create(name = 'notion') {
  const res = await handleCreateMcpConnection(
    req(`/v1/workspaces/${WS}/mcp-connections`, { method: 'POST', body: JSON.stringify({ name, serverUrl: MCP_URL }) }),
    e,
    admin,
    WS,
  );
  return { res, body: (await res.json()) as { id: string; registration: string; auth: string } };
}

async function connect(fake: ReturnType<typeof installFakeServer>, connectionId: string, user = member) {
  const res = await handleMcpConnect(req(`/v1/workspaces/${WS}/connections/${connectionId}/mcp/connect?returnUrl=/home`), e, user, WS, connectionId);
  const { authUrl } = (await res.json()) as { authUrl: string };
  return fake.approve(authUrl);
}

describe('MCP connections', () => {
  it('routes the metadata document and the callback through the worker on the apex', async () => {
    const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
    const doc = await worker.fetch(new Request('https://shareout.test/oauth/mcp-client.json'), e, ctx);
    expect(doc.status).toBe(200);
    expect(((await doc.json()) as { client_id: string }).client_id).toBe('https://shareout.test/oauth/mcp-client.json');
    const cb = await worker.fetch(new Request('https://shareout.test/v1/oauth/mcp/callback'), e, ctx);
    expect(cb.status).toBe(400);
    expect(await cb.text()).toContain('Missing code or state');
  });

  it('serves the client metadata document whose client_id is its own URL', async () => {
    const doc = (await handleMcpClientMetadata(e).json()) as { client_id: string; redirect_uris: string[] };
    expect(doc.client_id).toBe('https://shareout.test/oauth/mcp-client.json');
    expect(doc.redirect_uris).toEqual(['https://shareout.test/v1/oauth/mcp/callback']);
  });

  it('lets an admin add a server: discovery + CIMD, stored as a per-user platform connection', async () => {
    installFakeServer();
    const { res, body } = await create();
    expect(res.status).toBe(201);
    expect(body).toMatchObject({ auth: 'oauth', registration: 'cimd' });
    const row = await e.DB.prepare('SELECT kind, provider, credential_scope, auth_type FROM connections WHERE id = ?').bind(body.id).first();
    expect(row).toEqual({ kind: 'platform', provider: 'mcp', credential_scope: 'per_user', auth_type: 'oauth2' });
  });

  it('refuses non-admins, bad URLs and duplicate names', async () => {
    installFakeServer();
    const asMember = await handleCreateMcpConnection(
      req(`/v1/workspaces/${WS}/mcp-connections`, { method: 'POST', body: JSON.stringify({ name: 'x', serverUrl: MCP_URL }) }), e, member, WS,
    );
    expect(asMember.status).toBe(403);
    for (const serverUrl of ['http://mcp.example.com/mcp', 'https://127.0.0.1/mcp', 'not a url']) {
      const r = await handleCreateMcpConnection(
        req(`/v1/workspaces/${WS}/mcp-connections`, { method: 'POST', body: JSON.stringify({ name: 'x', serverUrl }) }), e, admin, WS,
      );
      expect(r.status, serverUrl).toBe(400);
    }
    await create('dup');
    expect((await create('dup')).res.status).toBe(409);
  });

  it('connects a member end to end: PKCE, code exchange, tokens per user, tools listed', async () => {
    const fake = installFakeServer();
    const { body } = await create();
    const { code, state } = await connect(fake, body.id);

    const res = await handleMcpOAuthCallback(req(`/v1/oauth/mcp/callback?code=${code}&state=${encodeURIComponent(state)}`), e, member.id);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('notion connected');

    const exchange = fake.state.tokenCalls[0];
    expect(exchange.get('grant_type')).toBe('authorization_code');
    expect(exchange.get('resource')).toBe(MCP_URL);
    expect(exchange.get('client_id')).toBe('https://shareout.test/oauth/mcp-client.json');

    const creds = await e.DB.prepare('SELECT user_id FROM connection_user_credentials WHERE connection_id = ?').bind(body.id).all();
    expect(creds.results).toEqual([{ user_id: member.id }]);

    const conn = await loadMcpConnection(e, WS, body.id);
    expect(conn?.config.tools?.map((t) => t.name)).toEqual(['search', 'create_page']);
  });

  it('rejects a callback replayed by another user, and a reused PKCE nonce', async () => {
    const fake = installFakeServer();
    const { body } = await create();
    const { code, state } = await connect(fake, body.id);

    const asAdmin = await handleMcpOAuthCallback(req(`/v1/oauth/mcp/callback?code=${code}&state=${encodeURIComponent(state)}`), e, admin.id);
    expect(asAdmin.status).toBe(400);

    const ok = await handleMcpOAuthCallback(req(`/v1/oauth/mcp/callback?code=${code}&state=${encodeURIComponent(state)}`), e, member.id);
    expect(ok.status).toBe(200);
    const replay = await handleMcpOAuthCallback(req(`/v1/oauth/mcp/callback?code=${code}&state=${encodeURIComponent(state)}`), e, member.id);
    expect(replay.status).toBe(400);
    expect(fake.state.tokenCalls).toHaveLength(1);
  });

  it('lists MCP servers in the catalog with each member\'s own connection state', async () => {
    const fake = installFakeServer();
    const { body } = await create();
    const { code, state } = await connect(fake, body.id);
    await handleMcpOAuthCallback(req(`/v1/oauth/mcp/callback?code=${code}&state=${encodeURIComponent(state)}`), e, member.id);

    const view = async (u: AuthUser) => {
      const d = (await (await handleWorkspaceConnectorsCatalog(e, u, WS)).json()) as {
        catalog: { id: string; connectMethod: string; connections: { name: string; hasMyCredentials?: boolean; auth?: string }[] }[];
        otherConnections: { provider: string }[];
      };
      return { mcp: d.catalog.find((p) => p.id === 'mcp')!, other: d.otherConnections };
    };
    const asMember = await view(member);
    expect(asMember.mcp.connectMethod).toBe('mcp');
    expect(asMember.mcp.connections).toEqual([expect.objectContaining({ name: 'notion', hasMyCredentials: true, auth: 'oauth' })]);
    expect(asMember.other.some((c) => c.provider === 'mcp')).toBe(false);
    expect((await view(admin)).mcp.connections[0].hasMyCredentials).toBe(false);
  });

  it('refuses connect for non-members', async () => {
    installFakeServer();
    const { body } = await create();
    const res = await handleMcpConnect(req(`/v1/workspaces/${WS}/connections/${body.id}/mcp/connect`), e, outsider, WS, body.id);
    expect(res.status).toBe(403);
  });

  it('tools refresh requires the caller to be connected', async () => {
    installFakeServer();
    const { body } = await create();
    const res = await handleRefreshMcpTools(e, member, WS, body.id);
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('CREDENTIALS_REQUIRED');
  });
});

describe('member token refresh', () => {
  async function seedExpired(fake: ReturnType<typeof installFakeServer>) {
    const { body } = await create();
    fake.state.refreshTokens.set('rt-old', 'at-old');
    const { encrypted, iv } = await encryptCredentials({ accessToken: 'at-old', refreshToken: 'rt-old', expiresAt: Date.now() - 1000 }, KEY);
    await e.DB.prepare(
      `INSERT INTO connection_user_credentials (connection_id, user_id, encrypted_credentials, iv) VALUES (?, ?, ?, ?)`,
    ).bind(body.id, member.id, encrypted, iv).run();
    return (await loadMcpConnection(e, WS, body.id))!;
  }

  it('refreshes once when concurrent callers find the token expired', async () => {
    const fake = installFakeServer();
    const conn = await seedExpired(fake);
    const tokens = await Promise.all(
      [1, 2, 3].map(() => getMemberAccessToken(e, conn.id, member.id, conn.config.oauth!, conn.clientSecret)),
    );
    expect(fake.state.tokenCalls.filter((f) => f.get('grant_type') === 'refresh_token')).toHaveLength(1);
    expect(new Set(tokens)).toEqual(new Set(['at1']));
  });

  it('disconnects the member when the grant is revoked', async () => {
    const fake = installFakeServer();
    const conn = await seedExpired(fake);
    fake.state.refreshTokens.clear();
    const err = await getMemberAccessToken(e, conn.id, member.id, conn.config.oauth!, conn.clientSecret).catch((x) => x);
    expect(err.code).toBe('needs_auth');
    const left = await e.DB.prepare('SELECT 1 FROM connection_user_credentials WHERE connection_id = ?').bind(conn.id).first();
    expect(left).toBeNull();
  });
});
