// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { handleFetch } from '../../../src/router/handle-fetch';
import { applyMigrations, e } from '../helpers/migrated-db';
import { hashToken } from '../../../src/api-auth';

vi.mock('@cloudflare/containers', () => ({ Container: class {}, getContainer: () => ({}) }));

const BASE = 'https://shareout.example.com';
const A_TOKEN = 'so_f02_owner_token';
const B_TOKEN = 'so_f02_member_token';
const WS = 'wsp_f02';

const get = (path: string, token: string) =>
  handleFetch(new Request(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } }), e, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES ('usr_f02_a', 'f02a@example.test', 'a'), ('usr_f02_b', 'f02b@example.test', 'b')"),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'W', 'f02-w', 'usr_f02_a')").bind(WS),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('wm_f02_a', ?, 'usr_f02_a', 'owner', 'internal'), ('wm_f02_b', ?, 'usr_f02_b', 'member', 'internal')").bind(WS, WS),
    e.DB.prepare("INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash, name) VALUES ('tok_f02_a', 'user', 'usr_f02_a', 'usr_f02_a', ?, 'a'), ('tok_f02_b', 'user', 'usr_f02_b', 'usr_f02_b', ?, 'b')")
      .bind(await hashToken(A_TOKEN), await hashToken(B_TOKEN)),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility) VALUES ('art_f02_priv', 'p', 'f02-priv', 'usr_f02_a', ?, 'private'), ('art_f02_ws', 'w', 'f02-ws', 'usr_f02_a', ?, 'workspace')").bind(WS, WS),
    e.DB.prepare("INSERT INTO collaborators (artifact_id, email, role) VALUES ('art_f02_priv', 'secret-collab@example.test', 'viewer'), ('art_f02_priv', 'f02a@example.test', 'owner')"),
  ]);
});

describe('f02 analytics/presence on a private artifact', () => {
  it('blocks: a non-collaborator workspace member gets 403 on analytics and presence', async () => {
    for (const suffix of ['analytics', 'presence']) {
      const res = await get(`/v1/artifacts/art_f02_priv/${suffix}`, B_TOKEN);
      expect(res.status, suffix).toBe(403);
      expect(await res.text()).not.toContain('secret-collab@example.test');
    }
  });

  it('owner still reads analytics; members still read workspace-visible artifact analytics', async () => {
    expect((await get('/v1/artifacts/art_f02_priv/analytics', A_TOKEN)).status).toBe(200);
    expect((await get('/v1/artifacts/art_f02_ws/analytics', B_TOKEN)).status).toBe(200);
  });
});
