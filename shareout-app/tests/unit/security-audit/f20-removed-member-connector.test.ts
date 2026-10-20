// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { handleFetch } from '../../../src/router/handle-fetch';
import { applyMigrations, e } from '../helpers/migrated-db';
import { hashToken } from '../../../src/api-auth';
import type { Env } from '../../../src/types';

vi.mock('@cloudflare/containers', () => ({ Container: class {}, getContainer: () => ({}) }));

const env = new Proxy(e, { get: (t, k, r) => (k === 'CREDENTIALS_KEY' ? 'f20-test-credentials-key-32bytes!!' : Reflect.get(t, k, r)) }) as unknown as Env;
const BASE = 'https://shareout.example.com';
const A_TOKEN = 'so_f20_owner_token';
const B_TOKEN = 'so_f20_member_token';
const WS = 'wsp_f20';
const ART = 'art_f20_b';
const DUMMY_KEY = 'dummy-shared-key-f20';

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
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES ('usr_f20_a', 'f20a@example.test', 'a'), ('usr_f20_b', 'f20b@example.test', 'b')"),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'W', 'f20-w', 'usr_f20_a')").bind(WS),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('wm_f20_a', ?, 'usr_f20_a', 'owner', 'internal'), ('wm_f20_b', ?, 'usr_f20_b', 'member', 'internal')").bind(WS, WS),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility) VALUES (?, 'B art', 'f20-b', 'usr_f20_b', ?, 'workspace')").bind(ART, WS),
  ]);
  await e.DB.prepare("INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash, name) VALUES ('tok_f20_a', 'user', 'usr_f20_a', 'usr_f20_a', ?, 'a'), ('tok_f20_b', 'user', 'usr_f20_b', 'usr_f20_b', ?, 'b')")
    .bind(await hashToken(A_TOKEN), await hashToken(B_TOKEN)).run();
});

describe('f20 removed member + shared connector via owned artifact', () => {
  it('blocks: removed member cannot run queries with the shared connector credential', async () => {
    const mk = await call(`/v1/workspaces/${WS}/connections`, {
      method: 'POST', token: A_TOKEN,
      body: JSON.stringify({
        name: 'crm', type: 'rest_api', config: { baseUrl: 'https://api.upstream.test' },
        credentials: { type: 'api_key', data: { apiKey: DUMMY_KEY } },
      }),
    });
    expect(mk.status).toBe(201);

    const seen: { url: string; auth: string | null }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input instanceof Request ? input.url : input), auth: new Headers(init?.headers).get('Authorization') });
      return new Response(JSON.stringify({ rows: [1, 2] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));

    const q = () => call(`/v1/data/${ART}/connections/crm/query`, { method: 'POST', token: B_TOKEN, body: JSON.stringify({ query: '/customers', options: { cache: false } }) });

    const before = await q();
    expect(before.status).toBe(200);

    const del = await call(`/v1/workspaces/${WS}/members/usr_f20_b`, { method: 'DELETE', token: A_TOKEN });
    expect(del.status).toBe(200);
    const m = await e.DB.prepare("SELECT COUNT(*) AS n FROM workspace_members WHERE user_id = 'usr_f20_b'").first<{ n: number }>();
    expect(m!.n).toBe(0);

    expect(seen).toHaveLength(1);
    seen.length = 0;
    const after = await q();
    expect(after.status).toBe(403);
    expect(seen).toEqual([]);
  });
});
