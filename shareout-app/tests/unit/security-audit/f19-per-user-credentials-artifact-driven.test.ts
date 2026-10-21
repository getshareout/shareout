// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { handleFetch } from '../../../src/router/handle-fetch';
import { applyMigrations, e } from '../helpers/migrated-db';
import { hashToken } from '../../../src/api-auth';
import { createAccessToken } from '../../../src/token';
import type { Env } from '../../../src/types';

vi.mock('@cloudflare/containers', () => ({ Container: class {}, getContainer: () => ({}) }));

const env = new Proxy(e, { get: (t, k, r) => (k === 'CREDENTIALS_KEY' ? 'f19-test-credentials-key-32bytes!!' : k === 'SESSION_SECRET' ? 'f19-test-session-secret' : Reflect.get(t, k, r)) }) as unknown as Env;
const BASE = 'https://shareout.example.com';
const A_TOKEN = 'so_f19_owner_token';
const B_TOKEN = 'so_f19_member_token';
const WS = 'wsp_f19';
const ART = 'art_f19_a';
const DUMMY_KEY = 'dummy-shared-key-f19';

const call = (path: string, init: RequestInit & { token: string }) => {
  const { token, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (rest.body) headers.set('Content-Type', 'application/json');
  return handleFetch(new Request(`${BASE}${path}`, { ...rest, headers }), env, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);
};

afterEach(() => vi.unstubAllGlobals());

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES ('usr_f19_author', 'f19author@example.test', 'a'), ('usr_f19_viewer', 'f19viewer@example.test', 'b')"),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'W', 'f19-w', 'usr_f19_author')").bind(WS),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('wm_f19_a', ?, 'usr_f19_author', 'owner', 'internal'), ('wm_f19_b', ?, 'usr_f19_viewer', 'member', 'internal')").bind(WS, WS),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility) VALUES (?, 'A art', 'f19-a', 'usr_f19_author', ?, 'workspace')").bind(ART, WS),
  ]);
  await e.DB.prepare("INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash, name) VALUES ('tok_f19_a', 'user', 'usr_f19_author', 'usr_f19_author', ?, 'a'), ('tok_f19_b', 'user', 'usr_f19_viewer', 'usr_f19_viewer', ?, 'b')")
    .bind(await hashToken(A_TOKEN), await hashToken(B_TOKEN)).run();
});


describe('f19 author artifact drives a viewer\'s per-user connector credentials', () => {
  it('blocks: a page only runs read-only queries with a viewer\'s saved credential, and per-user results cache', async () => {
    const mk = await call(`/v1/workspaces/${WS}/connections`, {
      method: 'POST', token: A_TOKEN,
      body: JSON.stringify({ name: 'crm', type: 'rest_api', credentialScope: 'per_user', config: { baseUrl: 'https://api.upstream.test' }, credentials: { type: 'api_key' } }),
    });
    expect(mk.status).toBe(201);
    const conns = await e.DB.prepare("SELECT id, credential_scope FROM connections WHERE scope_id = ? AND name = 'crm'").bind(WS).first<{ id: string; credential_scope: string }>();
    expect(conns!.credential_scope).toBe('per_user');
    const put = await call(`/v1/workspaces/${WS}/connections/${conns!.id}/my-credentials`, {
      method: 'PUT', token: B_TOKEN, body: JSON.stringify({ credentials: { type: 'api_key', data: { apiKey: DUMMY_KEY } } }),
    });
    expect(put.status).toBeLessThan(300);

    const seen: { method: string; auth: string | null }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_i: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ method: init?.method ?? 'GET', auth: new Headers(init?.headers).get('Authorization') });
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    const viewerToken = await createAccessToken(ART, 'viewer', env, 3600, 'f19viewer@example.test');
    const q = (query: unknown, options: unknown) => handleFetch(new Request(`${BASE}/v1/data/${ART}/connections/crm/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${viewerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, options }),
    }), env, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);
    expect((await q({ endpoint: '/x', method: 'DELETE' }, { cache: false })).status).toBe(403);
    expect(seen).toEqual([]);

    expect((await q({ endpoint: '/x', method: 'GET' }, { ttl: 60 })).status).toBe(200);
    const again = await q({ endpoint: '/x', method: 'GET' }, { ttl: 60 });
    expect(again.status).toBe(200);
    expect(((await again.json()) as { data: { cached?: boolean } }).data.cached).toBe(true);
    expect(seen).toEqual([{ method: 'GET', auth: `Bearer ${DUMMY_KEY}` }]);
  });
});
