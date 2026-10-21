// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { handleFetch } from '../../../src/router/handle-fetch';
import { applyMigrations, e } from '../helpers/migrated-db';
import { hashToken } from '../../../src/api-auth';
import { saveUserConnectionCredentials } from '../../../src/data/connections/user-credentials';
import type { Env } from '../../../src/types';

vi.mock('@cloudflare/containers', () => ({ Container: class {}, getContainer: () => ({}) }));

const KEY = 'f19b-test-credentials-key-32bytes!';
const env = { ...e, CREDENTIALS_KEY: KEY, SESSION_SECRET: 'f19b-test-session-secret' } as unknown as Env;
const BASE = 'https://shareout.example.com';
const WS = 'wsp_f19b';
const ART = 'art_f19b';
const CONN = 'conn_f19b_bq';
const A_TOKEN = 'so_f19b_owner_token';
const B_TOKEN = 'so_f19b_viewer_token';

const execute = (token: string, params: unknown) => handleFetch(new Request(`${BASE}/v1/data/${ART}/platform/bigquery/jobs.query/execute`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ connectionId: CONN, params }),
}), env, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);

const upstream: string[] = [];

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES ('usr_f19b_a', 'f19ba@example.test', 'a'), ('usr_f19b_b', 'f19bb@example.test', 'b')"),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'W', 'f19b-w', 'usr_f19b_a')").bind(WS),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('wm_f19b_a', ?, 'usr_f19b_a', 'owner', 'internal'), ('wm_f19b_b', ?, 'usr_f19b_b', 'member', 'internal')").bind(WS, WS),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility) VALUES (?, 'A art', 'f19b-a', 'usr_f19b_a', ?, 'workspace')").bind(ART, WS),
    e.DB.prepare("INSERT INTO connections (id, scope_type, scope_id, name, kind, provider, config, credential_scope) VALUES (?, 'workspace', ?, 'BQ', 'platform', 'bigquery', ?, 'per_user')").bind(CONN, WS, JSON.stringify({ projectId: 'proj' })),
    e.DB.prepare("INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash, name) VALUES ('tok_f19b_a', 'user', 'usr_f19b_a', 'usr_f19b_a', ?, 'a'), ('tok_f19b_b', 'user', 'usr_f19b_b', 'usr_f19b_b', ?, 'b')")
      .bind(await hashToken(A_TOKEN), await hashToken(B_TOKEN)),
  ]);
  for (const uid of ['usr_f19b_a', 'usr_f19b_b']) {
    await saveUserConnectionCredentials(env, CONN, uid, { access_token: `dummy-${uid}`, expires_at: Date.now() + 3_600_000 }, KEY);
  }
});

afterEach(() => { vi.unstubAllGlobals(); upstream.length = 0; });

describe('f19b per-user platform credentials from someone else\'s page', () => {
  it('blocks: a viewer\'s own credentials only run a single read-only statement', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      upstream.push(String(input));
      return new Response(JSON.stringify({ rows: [], jobComplete: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));

    for (const body of [
      { query: 'DROP TABLE ds.t', useLegacySql: false },
      { query: 'SELECT 1; DELETE FROM ds.t WHERE true' },
      { query: 'DELETE FROM ds.t WHERE true' },
    ]) {
      const res = await execute(B_TOKEN, { body });
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error?: string }).error).toContain('read-only');
    }
    expect(upstream).toEqual([]);

    const ok = await execute(B_TOKEN, { body: { query: 'SELECT 1', useLegacySql: false } });
    expect(ok.status).toBe(200);
    expect(upstream.length).toBe(1);

    const owner = await execute(A_TOKEN, { body: { query: 'DELETE FROM ds.t WHERE true' } });
    expect(owner.status).toBe(200);
    expect(upstream.length).toBe(2);
  });
});
