// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { handleFetch } from '../../../src/router/handle-fetch';
import { applyMigrations, e } from '../helpers/migrated-db';
import { hashToken } from '../../../src/api-auth';
import { saveUserConnectionCredentials } from '../../../src/data/connections/user-credentials';
import type { Env } from '../../../src/types';

vi.mock('@cloudflare/containers', () => ({ Container: class {}, getContainer: () => ({}) }));

const KEY = 'h6-test-credentials-key-32bytes!';
const env = { ...e, CREDENTIALS_KEY: KEY, SESSION_SECRET: 'h6-test-session-secret' } as unknown as Env;
const BASE = 'https://shareout.example.com';
const WS = 'wsp_h6';
const ART = 'art_h6';
const CONN = 'conn_h6_sheets';
const A_TOKEN = 'so_h6_owner_token';
const B_TOKEN = 'so_h6_viewer_token';

const execute = (token: string, endpoint: string, params: unknown) => handleFetch(new Request(`${BASE}/v1/data/${ART}/platform/google-sheets/${endpoint}/execute`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ connectionId: CONN, params }),
}), env, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);

const upstream: string[] = [];

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES ('usr_h6_a', 'h6a@example.test', 'a'), ('usr_h6_b', 'h6b@example.test', 'b')"),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'W', 'h6-w', 'usr_h6_a')").bind(WS),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('wm_h6_a', ?, 'usr_h6_a', 'owner', 'internal'), ('wm_h6_b', ?, 'usr_h6_b', 'member', 'internal')").bind(WS, WS),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility) VALUES (?, 'A art', 'h6-a', 'usr_h6_a', ?, 'workspace')").bind(ART, WS),
    e.DB.prepare("INSERT INTO connections (id, scope_type, scope_id, name, kind, provider, config, credential_scope) VALUES (?, 'workspace', ?, 'BQ', 'platform', 'bigquery', ?, 'per_user')").bind(CONN, WS, JSON.stringify({ projectId: 'proj' })),
    e.DB.prepare("INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash, name) VALUES ('tok_h6_a', 'user', 'usr_h6_a', 'usr_h6_a', ?, 'a'), ('tok_h6_b', 'user', 'usr_h6_b', 'usr_h6_b', ?, 'b')")
      .bind(await hashToken(A_TOKEN), await hashToken(B_TOKEN)),
  ]);
  for (const uid of ['usr_h6_a', 'usr_h6_b']) {
    await saveUserConnectionCredentials(env, CONN, uid, { access_token: `dummy-${uid}`, expires_at: Date.now() + 3_600_000 }, KEY);
  }
});

afterEach(() => { vi.unstubAllGlobals(); upstream.length = 0; });

const pathParams = { spreadsheetId: 'sheet1', range: 'A1' };

describe('h6 per-user non-SQL platform credentials from someone else\'s page', () => {
  it('blocks: a viewer\'s own credentials only run read endpoints', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      upstream.push(String(input));
      return new Response(JSON.stringify({ values: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));

    for (const endpoint of ['values.update', 'values.append', 'values.batchUpdate', 'no.such.endpoint']) {
      const res = await execute(B_TOKEN, endpoint, { pathParams, body: { values: [['x']] } });
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error?: string }).error).toContain('read');
    }
    expect(upstream).toEqual([]);

    const ok = await execute(B_TOKEN, 'values.get', { pathParams });
    expect(ok.status).toBe(200);
    expect(upstream.length).toBe(1);

    const owner = await execute(A_TOKEN, 'values.update', { pathParams, body: { values: [['x']] } });
    expect(owner.status).toBe(200);
    expect(upstream.length).toBe(2);
  });
});
