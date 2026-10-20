// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { handleFetch } from '../../../src/router/handle-fetch';
import { applyMigrations, e } from '../helpers/migrated-db';
import { hashToken } from '../../../src/api-auth';

vi.mock('@cloudflare/containers', () => ({ Container: class {}, getContainer: () => ({}) }));

const BASE = 'https://shareout.example.com';
const OWNER_TOKEN = 'so_f01_owner_token';
const WS = 'wsp_f01';
const ART_WS = 'art_f01_ws';
const ART_PRIV = 'art_f01_priv';

const call = (path: string, init: RequestInit & { token: string }) => {
  const { token, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (rest.body) headers.set('Content-Type', 'application/json');
  return handleFetch(new Request(`${BASE}${path}`, { ...rest, headers }), e, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);
};

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES ('usr_f01_owner', 'f01owner@example.test', 'o')"),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'W', 'f01-w', 'usr_f01_owner')").bind(WS),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('wm_f01_o', ?, 'usr_f01_owner', 'owner', 'internal')").bind(WS),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility) VALUES (?, 'A', 'f01-a', 'usr_f01_owner', ?, 'workspace'), (?, 'P', 'f01-p', 'usr_f01_owner', ?, 'private')")
      .bind(ART_WS, WS, ART_PRIV, WS),
  ]);
  await e.DB.prepare("INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash, name) VALUES ('tok_f01_o', 'user', 'usr_f01_owner', 'usr_f01_owner', ?, 'o')")
    .bind(await hashToken(OWNER_TOKEN)).run();
});

describe('f01 removing an Agent principal from Members', () => {
  it('blocks: sot_ token is revoked and loses data access after DELETE members/:principal', async () => {
    const mint = await call(`/v1/workspaces/${WS}/agent-tokens`, {
      method: 'POST', token: OWNER_TOKEN,
      body: JSON.stringify({ name: 'bot', scopes: ['data:read', 'data:write'] }),
    });
    expect(mint.status).toBe(201);
    const { token: sot, principal_user_id: principal } = await mint.json() as { token: string; principal_user_id: string };

    // owner seeds data in both artifacts
    for (const art of [ART_WS, ART_PRIV]) {
      const put = await call(`/v1/data/${art}/json/secret`, { method: 'PUT', token: OWNER_TOKEN, body: JSON.stringify({ value: 'workspace-data' }) });
      expect(put.status).toBeLessThan(300);
    }

    const before = await call(`/v1/data/${ART_WS}/json/secret`, { method: 'GET', token: sot });
    expect(before.status).toBe(200);

    const del = await call(`/v1/workspaces/${WS}/members/${principal}`, { method: 'DELETE', token: OWNER_TOKEN });
    expect(del.status).toBe(200);
    const m = await e.DB.prepare('SELECT COUNT(*) AS n FROM workspace_members WHERE workspace_id = ? AND user_id = ?').bind(WS, principal).first<{ n: number }>();
    expect(m!.n).toBe(0);
    const tok = await e.DB.prepare('SELECT revoked_at FROM tokens WHERE user_id = ? AND principal_type = ?').bind(principal, 'workspace').first<{ revoked_at: string | null }>();
    expect(tok!.revoked_at).not.toBeNull();

    const after = await call(`/v1/data/${ART_WS}/json/secret`, { method: 'GET', token: sot });
    expect(after.status).toBe(401);

    const write = await call(`/v1/data/${ART_WS}/json/planted`, { method: 'PUT', token: sot, body: JSON.stringify({ value: 'x' }) });
    expect(write.status).toBe(401);

    const owner = await call(`/v1/data/${ART_WS}/json/secret`, { method: 'GET', token: OWNER_TOKEN });
    expect(owner.status).toBe(200);
  });
});
