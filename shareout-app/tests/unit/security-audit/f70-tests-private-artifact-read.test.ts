// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { handleFetch } from '../../../src/router/handle-fetch';
import { applyMigrations, e } from '../helpers/migrated-db';
import { hashToken } from '../../../src/api-auth';

vi.mock('@cloudflare/containers', () => ({ Container: class {}, getContainer: () => ({}) }));

const BASE = 'https://shareout.example.com';
const A_TOKEN = 'so_f70_owner_token';
const B_TOKEN = 'so_f70_member_token';
const WS = 'wsp_f70';

const get = (path: string, token: string) =>
  handleFetch(new Request(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } }), e, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES ('usr_f70_a', 'f70a@example.test', 'a'), ('usr_f70_b', 'f70b@example.test', 'b')"),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'W', 'f70-w', 'usr_f70_a')").bind(WS),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('wm_f70_a', ?, 'usr_f70_a', 'owner', 'internal'), ('wm_f70_b', ?, 'usr_f70_b', 'member', 'internal')").bind(WS, WS),
    e.DB.prepare("INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash, name) VALUES ('tok_f70_a', 'user', 'usr_f70_a', 'usr_f70_a', ?, 'a'), ('tok_f70_b', 'user', 'usr_f70_b', 'usr_f70_b', ?, 'b')")
      .bind(await hashToken(A_TOKEN), await hashToken(B_TOKEN)),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility) VALUES ('art_f70_priv', 'p', 'f70-priv', 'usr_f70_a', ?, 'private'), ('art_f70_ws', 'w', 'f70-ws', 'usr_f70_a', ?, 'workspace')").bind(WS, WS),
  ]);
});

describe('f70 artifact tests read on a private artifact', () => {
  it('blocks: a non-collaborator workspace member gets 403', async () => {
    expect((await get('/v1/artifacts/art_f70_priv/tests', B_TOKEN)).status).toBe(403);
  });

  it('owner still reads; members still read workspace-visible artifact tests', async () => {
    expect((await get('/v1/artifacts/art_f70_priv/tests', A_TOKEN)).status).toBe(200);
    expect((await get('/v1/artifacts/art_f70_ws/tests', B_TOKEN)).status).toBe(200);
  });
});
