// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { handleFetch } from '../../../src/router/handle-fetch';
import { applyMigrations, e } from '../helpers/migrated-db';
import { hashToken } from '../../../src/api-auth';

vi.mock('@cloudflare/containers', () => ({ Container: class {}, getContainer: () => ({}) }));

const BASE = 'https://shareout.example.com';
const A_TOKEN = 'so_f18_owner_token';
const B_TOKEN = 'so_f18_member_token';
const WS = 'wsp_f18';

const get = (path: string, token: string) =>
  handleFetch(new Request(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } }), e, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES ('usr_f18_a', 'f18a@example.test', 'a'), ('usr_f18_b', 'f18b@example.test', 'b')"),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'W', 'f18-w', 'usr_f18_a')").bind(WS),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('wm_f18_a', ?, 'usr_f18_a', 'owner', 'internal'), ('wm_f18_b', ?, 'usr_f18_b', 'member', 'internal')").bind(WS, WS),
    e.DB.prepare("INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash, name) VALUES ('tok_f18_a', 'user', 'usr_f18_a', 'usr_f18_a', ?, 'a'), ('tok_f18_b', 'user', 'usr_f18_b', 'usr_f18_b', ?, 'b')")
      .bind(await hashToken(A_TOKEN), await hashToken(B_TOKEN)),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility) VALUES ('art_f18_priv', 'Private Payroll', 'f18-priv', 'usr_f18_a', ?, 'private'), ('art_f18_ws', 'Shared Board', 'f18-ws', 'usr_f18_a', ?, 'workspace'), ('art_f18_bm', 'Bobs Private', 'f18-bm', 'usr_f18_b', ?, 'private')").bind(WS, WS, WS),
    e.DB.prepare("INSERT INTO connections (id, scope_type, scope_id, name, provider, created_by) VALUES ('con_f18', 'workspace', ?, 'crm', 'postgres', 'usr_f18_a')").bind(WS),
    e.DB.prepare("INSERT INTO connection_usage (connection_id, artifact_id) VALUES ('con_f18', 'art_f18_priv'), ('con_f18', 'art_f18_ws'), ('con_f18', 'art_f18_bm')"),
  ]);
});

const ids = async (token: string) => {
  const res = await get(`/v1/workspaces/${WS}/connections/con_f18/artifacts`, token);
  expect(res.status).toBe(200);
  return ((await res.json()) as { artifacts: { id: string }[] }).artifacts.map((a) => a.id).sort();
};

describe('f18 connector usage list', () => {
  it('blocks: a member does not see other members\' private artifacts', async () => {
    expect(await ids(B_TOKEN)).not.toContain('art_f18_priv');
  });

  it('members still see workspace-visible and own private artifacts; owner sees theirs', async () => {
    expect(await ids(B_TOKEN)).toEqual(['art_f18_bm', 'art_f18_ws']);
    expect(await ids(A_TOKEN)).toEqual(['art_f18_priv', 'art_f18_ws']);
  });
});
