// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { handleFetch } from '../../../src/router/handle-fetch';
import { applyMigrations, e } from '../helpers/migrated-db';
import { hashToken } from '../../../src/api-auth';
import { createAccessToken, createSessionToken } from '../../../src/token';
import type { Env } from '../../../src/types';

vi.mock('@cloudflare/containers', () => ({ Container: class {}, getContainer: () => ({}) }));

const env = { ...e, CREDENTIALS_KEY: 'f19-test-credentials-key-32bytes!!', SESSION_SECRET: 'f19-test-session-secret' } as unknown as Env;
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
  it('blocks: a page uses a viewer\'s saved credential only after that viewer consented, reads and writes alike', async () => {
    const mk = await call(`/v1/workspaces/${WS}/connections`, {
      method: 'POST', token: A_TOKEN,
      body: JSON.stringify({ name: 'crm', type: 'rest_api', credentialScope: 'per_user', config: { baseUrl: 'https://api.upstream.test' }, credentials: { type: 'api_key' } }),
    });
    expect(mk.status).toBe(201);
    const conns = await e.DB.prepare("SELECT id, credential_scope FROM connections WHERE scope_id = ? AND name = 'crm'").bind(WS).first<{ id: string; credential_scope: string }>();
    expect(conns!.credential_scope).toBe('per_user');
    for (const [tok, key] of [[B_TOKEN, DUMMY_KEY], [A_TOKEN, 'dummy-owner-key-f19']]) {
      const put = await call(`/v1/workspaces/${WS}/connections/${conns!.id}/my-credentials`, {
        method: 'PUT', token: tok, body: JSON.stringify({ credentials: { type: 'api_key', data: { apiKey: key } } }),
      });
      expect(put.status).toBeLessThan(300);
    }

    const seen: { method: string; auth: string | null }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_i: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ method: init?.method ?? 'GET', auth: new Headers(init?.headers).get('Authorization') });
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    const viewerToken = await createAccessToken(ART, 'viewer', env, 3600, 'f19viewer@example.test');
    const ownerPageToken = await createAccessToken(ART, 'viewer', env, 3600, 'f19author@example.test');
    const send = (path: string, token: string, method: string, body?: unknown) => handleFetch(new Request(`${BASE}/v1/data/${ART}/connections/crm${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    }), env, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);
    const q = (query: unknown, options: unknown, token = viewerToken) => send('/query', token, 'POST', { query, options });

    for (const query of [{ endpoint: '/x', method: 'GET' }, { endpoint: '/x', method: 'DELETE' }]) {
      const res = await q(query, { cache: false });
      expect(res.status).toBe(403);
      const body = (await res.json()) as { code: string; consent_url: string };
      expect(body.code).toBe('CONSENT_REQUIRED');
      expect(body.consent_url).toBe(`${BASE}/connect-consent?artifact=${ART}&connection=crm`);
    }
    expect((await send('/materialize', viewerToken, 'POST', { query: { endpoint: '/x' }, target: { type: 'json', name: 'k' } })).status).toBe(403);
    expect(seen).toEqual([]);

    expect((await send('/consent', viewerToken, 'POST')).status).toBe(401);
    expect(await e.DB.prepare('SELECT 1 FROM connection_consents').first()).toBeNull();

    expect((await send('/consent', B_TOKEN, 'GET')).status).toBe(200);
    expect(((await (await send('/consent', B_TOKEN, 'GET')).json()) as { data: { consented: boolean } }).data.consented).toBe(false);
    expect((await send('/consent', B_TOKEN, 'POST')).status).toBe(200);

    expect((await q({ endpoint: '/x', method: 'GET' }, { ttl: 60 })).status).toBe(200);
    const again = await q({ endpoint: '/x', method: 'GET' }, { ttl: 60 });
    expect(((await again.json()) as { data: { cached?: boolean } }).data.cached).toBe(true);
    expect((await q({ endpoint: '/x', method: 'DELETE' }, { cache: false })).status).toBe(200);
    expect(seen).toEqual([{ method: 'GET', auth: `Bearer ${DUMMY_KEY}` }, { method: 'DELETE', auth: `Bearer ${DUMMY_KEY}` }]);

    expect((await send('/consent', B_TOKEN, 'DELETE')).status).toBe(200);
    expect((await q({ endpoint: '/x', method: 'GET' }, { cache: false })).status).toBe(403);

    expect((await q({ endpoint: '/own', method: 'DELETE' }, { cache: false }, ownerPageToken)).status).toBe(200);
    expect(seen.at(-1)).toEqual({ method: 'DELETE', auth: 'Bearer dummy-owner-key-f19' });
  });

  it('serves the consent page only to a signed-in same-origin approver', async () => {
    const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
    const url = `${BASE}/connect-consent?artifact=${ART}&connection=crm`;
    const anon = await handleFetch(new Request(url, { redirect: 'manual' }), env, ctx);
    expect(anon.status).toBe(302);
    expect(anon.headers.get('Location')).toContain('/auth/login');

    const cookie = `shareout_session=${await createSessionToken('usr_f19_viewer', 'f19viewer@example.test', env)}`;
    const page = await (await handleFetch(new Request(url, { headers: { Cookie: cookie } }), env, ctx)).text();
    expect(page).toContain('A art');
    expect(page).toContain('Approve');

    const form = new URLSearchParams({ artifact: ART, connection: 'crm', decision: 'approve' });
    const post = (headers: Record<string, string>) => handleFetch(new Request(`${BASE}/connect-consent`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: form }), env, ctx);
    await post({ 'Sec-Fetch-Site': 'cross-site' });
    expect(await e.DB.prepare('SELECT 1 FROM connection_consents').first()).toBeNull();
    expect((await post({ 'Sec-Fetch-Site': 'same-origin' })).status).toBe(200);
    expect(await e.DB.prepare("SELECT 1 FROM connection_consents WHERE user_id = 'usr_f19_viewer'").first()).not.toBeNull();
  });
});
