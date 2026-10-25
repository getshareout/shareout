import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../../../src/api-auth';
import worker from '../../../src/index';
import { applyMigrations, e } from '../helpers/migrated-db';
import { createSessionToken, createAccessToken } from '../../../src/token';
import {
  handleCreateMcpConnection,
  handleMcpConnect,
  handleMcpOAuthCallback,
} from '../../../src/router/api/workspace-connections/mcp';
import { installFakeServer, MCP_URL } from '../mcp-client/fake-server';

const WS = 'wsp_broker';
const admin: AuthUser = { id: 'usr_b_admin', email: 'badmin@x.test', username: null };
const member: AuthUser = { id: 'usr_b_member', email: 'bmember@x.test', username: null };
const other: AuthUser = { id: 'usr_b_other', email: 'bother@x.test', username: null };
const outsider: AuthUser = { id: 'usr_b_out', email: 'bout@x.test', username: null };
const ORIGIN = 'https://shareout.test';
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

const declared = (tools = ['search', 'create_page']) => ({ mcp: { connections: [{ name: 'notion', tools }] } });

async function makeArtifact(id: string, visibility: string, capabilities: unknown, workspaceId: string | null = WS) {
  await e.DB.batch([
    e.DB.prepare('INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(id, id, `slug-${id}`, admin.id, workspaceId, visibility),
    e.DB.prepare('INSERT INTO versions (id, artifact_id, version_no, entrypoint, manifest_json) VALUES (?, ?, 1, ?, ?)')
      .bind(`ver_${id}`, id, 'index.html', JSON.stringify(capabilities ? { capabilities } : {})),
    e.DB.prepare("INSERT INTO deployments (id, artifact_id, version_id, channel, slug) VALUES (?, ?, ?, 'production', ?)")
      .bind(`dep_${id}`, id, `ver_${id}`, `slug-${id}`),
  ]);
}

async function cookie(user: AuthUser) {
  return `shareout_session=${await createSessionToken(user.id, user.email!, e)}`;
}

async function host(path: string, user: AuthUser | null, init: RequestInit = {}, sameOrigin = true) {
  const headers = new Headers(init.headers);
  if (user) headers.set('Cookie', await cookie(user));
  if (sameOrigin) headers.set('Sec-Fetch-Site', 'same-origin');
  return worker.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }), e, ctx);
}

async function mcpToken(artifactId: string, user: AuthUser): Promise<string> {
  const res = await host(`/v1/artifacts/${artifactId}/mcp/token`, user);
  expect(res.status).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

async function broker(artifactId: string, token: string, action: 'list' | 'call', body?: unknown) {
  return worker.fetch(new Request(`${ORIGIN}/v1/data/${artifactId}/mcp/${action}`, {
    method: action === 'call' ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Origin: 'null' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), e, ctx);
}

const code = async (res: Response) => ((await res.clone().json()) as { code: string }).code;

beforeAll(async () => {
  await applyMigrations();
  (e as { CREDENTIALS_KEY?: string }).CREDENTIALS_KEY = 'test-key-32-chars-long-enough!!!';
  (e as { SESSION_SECRET: string }).SESSION_SECRET ||= 'test-session-secret-for-mcp-broker';
  await e.DB.batch([
    ...[admin, member, other, outsider].map((u) => e.DB.prepare('INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)').bind(u.id, u.email)),
    e.DB.prepare('INSERT OR IGNORE INTO workspaces (id, name, slug, owner_id) VALUES (?, ?, ?, ?)').bind(WS, 'B', 'broker-ws', admin.id),
    e.DB.prepare(`INSERT OR IGNORE INTO workspace_members (id, workspace_id, user_id, role) VALUES
      ('wm_b1', ?, ?, 'admin'), ('wm_b2', ?, ?, 'member'), ('wm_b3', ?, ?, 'member')`)
      .bind(WS, admin.id, WS, member.id, WS, other.id),
  ]);

  const fake = installFakeServer();
  const created = await handleCreateMcpConnection(
    new Request(`${ORIGIN}/v1/workspaces/${WS}/mcp-connections`, { method: 'POST', body: JSON.stringify({ name: 'notion', serverUrl: MCP_URL }) }),
    e, admin, WS,
  );
  const { id } = (await created.json()) as { id: string };
  const connect = await handleMcpConnect(new Request(`${ORIGIN}/x`), e, member, WS, id);
  const approved = fake.approve(((await connect.json()) as { authUrl: string }).authUrl);
  const cb = await handleMcpOAuthCallback(
    new Request(`${ORIGIN}/v1/oauth/mcp/callback?code=${approved.code}&state=${encodeURIComponent(approved.state)}`), e, member.id,
  );
  expect(cb.status).toBe(200);
  // Keep the issued member token valid for the per-test fake servers.
  (globalThis as { __issued?: Set<string> }).__issued = new Set(fake.state.validAccessTokens);
  vi.restoreAllMocks();

  await makeArtifact('art_mcp', 'workspace', declared());
  await makeArtifact('art_public', 'public', declared());
  await makeArtifact('art_plain', 'workspace', null);
});

afterEach(() => vi.restoreAllMocks());

function fakeWithMemberToken() {
  const fake = installFakeServer();
  for (const t of (globalThis as { __issued?: Set<string> }).__issued ?? []) fake.state.validAccessTokens.add(t);
  return fake;
}

describe('host-page MCP routes', () => {
  it('mint tokens only for same-origin, signed-in members of a members-only MCP page', async () => {
    expect((await host('/v1/artifacts/art_mcp/mcp/token', member, {}, false)).status).toBe(403);
    expect((await host('/v1/artifacts/art_mcp/mcp/token', null)).status).toBe(401);
    expect((await host('/v1/artifacts/art_mcp/mcp/token', outsider)).status).toBe(403);
    expect(await code(await host('/v1/artifacts/art_public/mcp/token', member))).toBe('MCP_NOT_AVAILABLE');
    expect(await code(await host('/v1/artifacts/art_plain/mcp/token', member))).toBe('MCP_NOT_AVAILABLE');
    expect((await host('/v1/artifacts/art_mcp/mcp/token', member)).status).toBe(200);
  });

  it('reports consent state and grants/revokes it', async () => {
    const initial = (await (await host('/v1/artifacts/art_mcp/mcp/consent', member)).json()) as { connections: { name: string; connected: boolean; allowed: boolean }[] };
    expect(initial.connections[0]).toMatchObject({ name: 'notion', connected: true, allowed: false });

    const granted = await host('/v1/artifacts/art_mcp/mcp/consent', member, { method: 'POST', body: JSON.stringify({ connections: ['notion'] }) });
    expect(((await granted.json()) as { connections: { allowed: boolean }[] }).connections[0].allowed).toBe(true);

    const notDeclared = await host('/v1/artifacts/art_mcp/mcp/consent', member, { method: 'POST', body: JSON.stringify({ connections: ['github'] }) });
    expect(notDeclared.status).toBe(400);

    const revoked = await host('/v1/artifacts/art_mcp/mcp/consent?connection=notion', member, { method: 'DELETE' });
    expect(((await revoked.json()) as { connections: { allowed: boolean }[] }).connections[0].allowed).toBe(false);
  });
});

describe('MCP broker', () => {
  it('refuses anything but a broker token, including the artifact data token', async () => {
    const dataToken = await createAccessToken('art_mcp', 'viewer', e, 3600, member.email!);
    expect(await code(await broker('art_mcp', dataToken, 'list'))).toBe('token_invalid');
    expect(await code(await broker('art_mcp', 'garbage', 'list'))).toBe('token_invalid');
    const forOther = await mcpToken('art_mcp', member);
    expect(await code(await broker('art_plain', forOther, 'list'))).toBe('token_invalid');
  });

  it('runs the full flow: approval required, then the call runs as the member with a reused session', async () => {
    const fake = fakeWithMemberToken();
    const token = await mcpToken('art_mcp', member);

    const before = await broker('art_mcp', token, 'call', { connection: 'notion', tool: 'search', input: { q: 'roadmap' } });
    expect(await code(before)).toBe('approval_required');

    await host('/v1/artifacts/art_mcp/mcp/consent', member, { method: 'POST', body: JSON.stringify({ connections: ['notion'] }) });
    const res = await broker('art_mcp', token, 'call', { connection: 'notion', tool: 'search', input: { q: 'roadmap' } });
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { structuredContent: unknown } };
    expect(data.structuredContent).toEqual({ ok: true, args: { q: 'roadmap' } });

    await broker('art_mcp', token, 'call', { connection: 'notion', tool: 'search', input: { q: 'again' } });
    const inits = fake.state.calls.filter((c) => c.url === MCP_URL && c.body.includes('"initialize"'));
    expect(inits).toHaveLength(1);
    const toolCalls = fake.state.calls.filter((c) => c.body.includes('"tools/call"'));
    expect(toolCalls.every((c) => c.headers.get('Authorization')?.startsWith('Bearer at'))).toBe(true);

    const list = (await (await broker('art_mcp', token, 'list')).json()) as { data: { connections: { allowed: boolean; tools: { name: string; readOnly: boolean }[] }[] } };
    expect(list.data.connections[0].allowed).toBe(true);
    expect(list.data.connections[0].tools).toEqual([
      { name: 'search', description: 'Search', readOnly: true },
      { name: 'create_page', description: '', readOnly: false },
    ]);
  });

  it('refuses undeclared tools and tools not marked read-only', async () => {
    fakeWithMemberToken();
    const token = await mcpToken('art_mcp', member);
    await host('/v1/artifacts/art_mcp/mcp/consent', member, { method: 'POST', body: JSON.stringify({ connections: ['notion'] }) });
    expect(await code(await broker('art_mcp', token, 'call', { connection: 'notion', tool: 'delete_everything' }))).toBe('not_in_manifest');
    expect(await code(await broker('art_mcp', token, 'call', { connection: 'other', tool: 'search' }))).toBe('not_in_manifest');
    expect(await code(await broker('art_mcp', token, 'call', { connection: 'notion', tool: 'create_page' }))).toBe('not_read_only');
  });

  it('asks a member who never connected to connect first', async () => {
    fakeWithMemberToken();
    const token = await mcpToken('art_mcp', other);
    await host('/v1/artifacts/art_mcp/mcp/consent', other, { method: 'POST', body: JSON.stringify({ connections: ['notion'] }) });
    const res = await broker('art_mcp', token, 'call', { connection: 'notion', tool: 'search' });
    expect(await code(res)).toBe('credentials_required');
  });

  it('a changed declaration makes old tokens stale and asks for consent again', async () => {
    fakeWithMemberToken();
    await makeArtifact('art_change', 'workspace', declared(['search']));
    const oldToken = await mcpToken('art_change', member);
    await host('/v1/artifacts/art_change/mcp/consent', member, { method: 'POST', body: JSON.stringify({ connections: ['notion'] }) });
    expect((await broker('art_change', oldToken, 'call', { connection: 'notion', tool: 'search' })).status).toBe(200);

    await e.DB.prepare('UPDATE versions SET manifest_json = ? WHERE id = ?')
      .bind(JSON.stringify({ capabilities: declared(['search', 'create_page']) }), 'ver_art_change').run();
    expect(await code(await broker('art_change', oldToken, 'call', { connection: 'notion', tool: 'search' }))).toBe('token_stale');

    const fresh = await mcpToken('art_change', member);
    expect(await code(await broker('art_change', fresh, 'call', { connection: 'notion', tool: 'search' }))).toBe('approval_required');
  });

  it('answers a call without waiting on the rate-limit counter write', async () => {
    fakeWithMemberToken();
    const token = await mcpToken('art_mcp', member);
    await host('/v1/artifacts/art_mcp/mcp/consent', member, { method: 'POST', body: JSON.stringify({ connections: ['notion'] }) });
    const counterWrites: Promise<void>[] = [];
    const kv = {
      get: async () => null,
      put: (key: string) => {
        if (!key.startsWith('rl:mcpBroker:')) return Promise.resolve(); // e.g. the MCP session cache
        const write = new Promise<void>(() => {}); // the counter write never settles
        counterWrites.push(write);
        return write;
      },
    };
    const deferred: Promise<unknown>[] = [];
    const waitCtx = { waitUntil: (p: Promise<unknown>) => { deferred.push(p); }, passThroughOnException: () => {} } as unknown as ExecutionContext;

    const res = await worker.fetch(new Request(`${ORIGIN}/v1/data/art_mcp/mcp/call`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Origin: 'null' },
      body: JSON.stringify({ connection: 'notion', tool: 'search', input: { q: 'roadmap' } }),
    }), { ...e, RATE_LIMIT_KV: kv } as never, waitCtx);
    expect(res.status).toBe(200);
    expect(counterWrites).toHaveLength(1);
    expect(deferred).toContain(counterWrites[0]);
  });

  it('stops working when the page becomes public', async () => {
    await makeArtifact('art_flip', 'workspace', declared());
    const token = await mcpToken('art_flip', member);
    await e.DB.prepare("UPDATE artifacts SET visibility = 'public' WHERE id = 'art_flip'").run();
    expect(await code(await broker('art_flip', token, 'list'))).toBe('mcp_not_available');
  });
});
