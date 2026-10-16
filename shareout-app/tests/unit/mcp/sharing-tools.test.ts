// Folder sharing tools over MCP against the real migrated schema and the real REST
// handlers: who can see a folder, who opened what, share with expiry, revoke — the
// folder's manager (admin or creator) may, other members and outside people may not.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuthUser } from '../../../src/api-auth';
import { invalidateGrants } from '../../../src/access/can-access';
import { callTool } from '../../../src/mcp/tools';
import { applyMigrations, e } from '../helpers/migrated-db';
import { setWorkspaceFlag } from '../../../src/features/flags';
import { EXTERNAL_SHARING_FEATURE } from '../../../src/sharees/guard';

const WS = 'wsp_mcps';
const u = (id: string, email: string): AuthUser => ({ id, email, username: null });
const admin = u('usr_mcps_admin', 'admin@example.com');
const creator = u('usr_mcps_creator', 'creator@example.com');
const member = u('usr_mcps_member', 'member@example.com');
const outsider = u('usr_mcps_ext', 'outsider@example.com');

const ctx = (user: AuthUser) => ({ env: e, user, origin: 'https://shareout.test', authorization: 'Bearer so_test' });
const call = (user: AuthUser, name: string, args: Record<string, unknown>) => callTool(ctx(user), name, args).then((r) => r!);
const grantCount = async (folder: string) =>
  (await e.DB.prepare("SELECT COUNT(*) AS n FROM grants WHERE workspace_id = ? AND resource_type = 'folder' AND resource_id = ?").bind(WS, folder).first<{ n: number }>())!.n;

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    ...[admin, creator, member, outsider].map((x) => e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(x.id, x.email, x.email!.split('@')[0])),
    e.DB.prepare('INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, ?, ?, ?)').bind(WS, 'Acme', 'acme-mcps', admin.id),
    e.DB.prepare(`INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES
      ('wm_mcps_1', ?, ?, 'admin', 'internal'), ('wm_mcps_2', ?, ?, 'member', 'internal'),
      ('wm_mcps_3', ?, ?, 'member', 'internal'), ('wm_mcps_4', ?, ?, 'member', 'external')`)
      .bind(WS, admin.id, WS, creator.id, WS, member.id, WS, outsider.id),
    e.DB.prepare(`INSERT INTO folders (id, workspace_id, name, slug, parent_id, visibility, created_by) VALUES
      ('fld_mcps_root', ?, 'Clients', 'clients', NULL, 'public', ?),
      ('fld_mcps_q3', ?, 'Q3', 'q3', 'fld_mcps_root', 'inherit', ?),
      ('fld_mcps_board', ?, 'Board', 'board', NULL, 'private', ?)`)
      .bind(WS, admin.id, WS, creator.id, WS, admin.id),
    e.DB.prepare("INSERT INTO artifacts (id, owner_id, name, slug, visibility, workspace_id, folder_id) VALUES ('art_mcps_q3', ?, 'Q3 deck', 'mcps-q3', 'workspace', ?, 'fld_mcps_q3')")
      .bind(creator.id, WS),
    e.DB.prepare("INSERT INTO sharee_activity (id, workspace_id, user_id, resource_type, resource_id, action, created_at) VALUES ('sa_mcps_1', ?, ?, 'artifact', 'art_mcps_q3', 'view', '2026-03-01T10:00:00.000Z')")
      .bind(WS, outsider.id),
  ]);
});

beforeEach(async () => {
  await e.DB.exec(`DELETE FROM grants WHERE workspace_id = '${WS}'`);
  await e.DB.prepare('UPDATE workspaces SET member_folders_enabled = 1 WHERE id = ?').bind(WS).run();
  await setWorkspaceFlag(e, WS, EXTERNAL_SHARING_FEATURE, null);
  await invalidateGrants(e, WS);
});

async function grantOn(folder: string, id: string) {
  await e.DB.prepare("INSERT INTO grants (id, workspace_id, subject_type, subject_id, resource_type, resource_id, capability, granted_by) VALUES (?, ?, 'external_user', ?, 'folder', ?, 'view', ?)")
    .bind(id, WS, outsider.id, folder, admin.id).run();
}

describe('folder_access', () => {
  it('tells a member who can see a folder, inherited visibility and grants included', async () => {
    await grantOn('fld_mcps_root', 'grt_mcps_root');
    const r = await call(member, 'folder_access', { folder: 'Q3' });
    expect(r.isError).toBeUndefined();
    expect(r.content[0].text).toContain('anyone with the link');
    expect(r.content[0].text).toContain('parent folder "Clients"');
    expect(r.content[0].text).toContain('outsider@example.com');
    expect(r.content[0].text).toContain('grant grt_mcps_root');
    expect(r.structuredContent).toMatchObject({ folder_id: 'fld_mcps_q3', effective: 'public', inheritedFrom: { id: 'fld_mcps_root' } });
  });

  it('refuses an outside person even though they have a membership edge', async () => {
    const r = await call(outsider, 'folder_access', { folder: 'Q3' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toMatch(/not a member of that workspace/);
    expect(r.structuredContent).toBeUndefined();
  });
});

describe('folder_activity', () => {
  it("shows the folder's creator who opened what in it", async () => {
    const r = await call(creator, 'folder_activity', { folder: 'fld_mcps_q3' });
    expect(r.isError).toBeUndefined();
    expect(r.content[0].text).toContain('outsider@example.com view "Q3 deck"');
  });

  it("refuses a member on someone else's folder", async () => {
    const r = await call(member, 'folder_activity', { folder: 'Q3' });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ status: 403 });
    expect(r.content[0].text).not.toContain('outsider@example.com');
  });
});

describe('share_with_person', () => {
  it("lets the folder's creator share it for 30 days and returns the portal link", async () => {
    const before = Date.now();
    const r = await call(creator, 'share_with_person', { email: 'client@acme.test', folder: 'Q3', expires_in_days: 30 });
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent!.portal_url).toBe('https://shareout.test/shared?folder=fld_mcps_q3');
    const grant = r.structuredContent!.grant as { id: string; expires_at: string; capability: string };
    expect(grant.capability).toBe('view');
    const days = (Date.parse(grant.expires_at) - before) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
    expect(r.content[0].text).toContain(`revoke_share with grant ${grant.id}`);
  });

  it("refuses a member on someone else's folder and creates no grant", async () => {
    const r = await call(member, 'share_with_person', { email: 'client@acme.test', folder: 'Board' });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ status: 403 });
    expect(await grantCount('fld_mcps_board')).toBe(0);
  });

  it('rejects a bad expiry through the same validation as the API', async () => {
    const r = await call(creator, 'share_with_person', { email: 'client@acme.test', folder: 'Q3', expires_at: '2000-01-01' });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain('expires_at must be in the future');
    expect(await grantCount('fld_mcps_q3')).toBe(0);
  });
});

describe('external sharing turned off', () => {
  it("refuses the folder's creator and an admin, and creates no grant", async () => {
    await setWorkspaceFlag(e, WS, EXTERNAL_SHARING_FEATURE, false);
    for (const who of [creator, admin]) {
      const r = await call(who, 'share_with_person', { email: 'client@acme.test', folder: 'Q3' });
      expect(r.isError).toBe(true);
      expect(r.structuredContent).toMatchObject({ status: 403, code: 'EXTERNAL_SHARING_NOT_ENTITLED' });
    }
    expect(await grantCount('fld_mcps_q3')).toBe(0);
  });

  it("still lets the folder's creator revoke an existing share", async () => {
    await grantOn('fld_mcps_q3', 'grt_mcps_off');
    await setWorkspaceFlag(e, WS, EXTERNAL_SHARING_FEATURE, false);
    const r = await call(creator, 'revoke_share', { grant_id: 'grt_mcps_off' });
    expect(r.isError).toBeUndefined();
    expect(await grantCount('fld_mcps_q3')).toBe(0);
  });
});

describe('revoke_share', () => {
  it("refuses a member on a folder they don't manage, then lets its creator revoke", async () => {
    await grantOn('fld_mcps_q3', 'grt_mcps_q3');
    const denied = await call(member, 'revoke_share', { grant_id: 'grt_mcps_q3' });
    expect(denied.isError).toBe(true);
    expect(await grantCount('fld_mcps_q3')).toBe(1);

    const r = await call(creator, 'revoke_share', { grant_id: 'grt_mcps_q3' });
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent).toMatchObject({ revoked: true });
    expect(await grantCount('fld_mcps_q3')).toBe(0);
  });
});
