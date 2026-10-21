// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { handleFetch } from '../../../src/router/handle-fetch';
import { applyMigrations, e } from '../helpers/migrated-db';
import { hashToken } from '../../../src/api-auth';
import { canAccess } from '../../../src/access/can-access';

vi.mock('@cloudflare/containers', () => ({ Container: class {}, getContainer: () => ({}) }));

const BASE = 'https://shareout.example.com';
const A_TOKEN = 'so_f41_admin_token';
const WS = 'wsp_f41';

const call = (path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${A_TOKEN}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  return handleFetch(new Request(`${BASE}${path}`, { ...init, headers }), e, { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext);
};

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES ('usr_f41_a', 'f41a@example.test', 'a')"),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'W', 'f41-w', 'usr_f41_a')").bind(WS),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('wm_f41_a', ?, 'usr_f41_a', 'owner', 'internal')").bind(WS),
    e.DB.prepare("INSERT INTO tokens (id, principal_type, principal_id, user_id, token_hash, name) VALUES ('tok_f41_a', 'user', 'usr_f41_a', 'usr_f41_a', ?, 'a')").bind(await hashToken(A_TOKEN)),
    e.DB.prepare("INSERT INTO folders (id, workspace_id, name, slug, created_by) VALUES ('fld_f41', ?, 'F', 'f41-f', 'usr_f41_a')").bind(WS),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility, folder_id) VALUES ('art_f41', 'x', 'f41-x', 'usr_f41_a', ?, 'private', 'fld_f41')").bind(WS),
  ]);
});

describe('f41 revoking a pending external invite', () => {
  it('blocks: grants and sharee links are dropped with the invite', async () => {
    const share = await call(`/v1/workspaces/${WS}/share-person`, {
      method: 'POST',
      body: JSON.stringify({ email: 'f41ext@example.test', resource_type: 'folder', resource_id: 'fld_f41', capability: 'view' }),
    });
    expect(share.status, await share.clone().text()).toBe(201);
    const ext = (await e.DB.prepare("SELECT id FROM users WHERE email = 'f41ext@example.test'").first<{ id: string }>())!.id;
    const identity = { userIds: [ext], emails: ['f41ext@example.test'] };
    expect(await canAccess(e, identity, 'artifact', 'art_f41', 'view')).toBe(true);

    const claim = await e.DB.prepare('SELECT id FROM workspace_invite_claims WHERE workspace_id = ? AND user_id = ? AND claimed_at IS NULL').bind(WS, ext).first<{ id: string }>();
    expect(claim).toBeTruthy();
    const del = await call(`/v1/workspaces/${WS}/invites/${claim!.id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);

    expect(await canAccess(e, identity, 'artifact', 'art_f41', 'view')).toBe(false);
    const grants = await e.DB.prepare("SELECT COUNT(*) AS n FROM grants WHERE workspace_id = ? AND subject_id = ?").bind(WS, ext).first<{ n: number }>();
    expect(grants?.n).toBe(0);
  });
});
