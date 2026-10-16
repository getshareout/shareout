// A folder's visibility is not enforced on what is inside it, so the access pill reports
// the real audience: the most open of the folder setting and its non-deleted contents.
// Item names go to folder managers only; other members get the label and counts.
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import { queryFolderAccess, queryPersonalFolderAccess } from '../../../src/pages/home/queries/folders';
import { handleHomeBrowserApi } from '../../../src/pages/home/api';
import { callTool } from '../../../src/mcp/tools';
import type { AuthUser } from '../../../src/api-auth';

const WS = 'wsp_fat';
const u = (id: string, email: string) => ({ id, email, username: null } as AuthUser);
const admin = u('usr_fat_admin', 'admin@example.com');
const member = u('usr_fat_member', 'member@example.com');
const alice = u('usr_fat_alice', 'alice@example.com');

const art = (id: string, folder: string, visibility: string, deleted = false, ws: string | null = WS, owner = admin.id) =>
  e.DB.prepare(`INSERT INTO artifacts (id, owner_id, name, slug, visibility, workspace_id, folder_id, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, owner, `Page ${id}`, `fat-${id}`, visibility, ws, folder, deleted ? new Date().toISOString() : null);

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    ...[admin, member, alice].map((x) => e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(x.id, x.email, x.email!.split('@')[0])),
    e.DB.prepare('INSERT INTO workspaces (id, name, slug, owner_id, member_folders_enabled) VALUES (?, ?, ?, ?, 0)').bind(WS, 'Acme', 'acme-fat', admin.id),
    e.DB.prepare(`INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES
      ('wm_fat_1', ?, ?, 'admin', 'internal'), ('wm_fat_2', ?, ?, 'member', 'internal')`).bind(WS, admin.id, WS, member.id),
    e.DB.prepare(`INSERT INTO folders (id, workspace_id, owner_id, name, slug, parent_id, visibility, created_by) VALUES
      ('fld_fat_board', ?, NULL, 'Board', 'board', NULL, 'private', ?),
      ('fld_fat_deep', ?, NULL, 'Deep', 'deep', 'fld_fat_board', 'inherit', ?),
      ('fld_fat_team', ?, NULL, 'Team', 'team', NULL, 'workspace', ?),
      ('fld_fat_gone', ?, NULL, 'Gone', 'gone', NULL, 'private', ?),
      ('fld_fat_mine', NULL, ?, 'Mine', 'mine', NULL, 'inherit', ?)`)
      .bind(WS, admin.id, WS, admin.id, WS, admin.id, WS, admin.id, alice.id, alice.id),
    art('a1', 'fld_fat_board', 'private'),
    art('a2', 'fld_fat_board', 'workspace'),
    art('a3', 'fld_fat_deep', 'workspace'),
    art('a4', 'fld_fat_deep', 'public'),
    art('a5', 'fld_fat_deep', 'public', true),
    art('a6', 'fld_fat_team', 'workspace'),
    art('a7', 'fld_fat_team', 'unlisted'),
    art('a8', 'fld_fat_gone', 'public', true),
    art('a9', 'fld_fat_gone', 'workspace', true),
    art('p1', 'fld_fat_mine', 'public', false, null, alice.id),
    art('p2', 'fld_fat_mine', 'private', false, null, alice.id),
    e.DB.prepare(`INSERT INTO asset_deliverables (id, bucket_artifact_id, workspace_id, owner_id, name, folder_id, visibility, deleted_at) VALUES
      ('dlv_fat_1', 'art_bucket', ?, ?, 'Logo.png', 'fld_fat_board', 'workspace', NULL),
      ('dlv_fat_2', 'art_bucket', ?, ?, 'Plan.pdf', 'fld_fat_board', 'private', NULL),
      ('dlv_fat_3', 'art_bucket', ?, ?, 'Old.pdf', 'fld_fat_gone', 'workspace', ?)`)
      .bind(WS, admin.id, WS, admin.id, WS, admin.id, new Date().toISOString()),
  ]);
});

describe('queryFolderAccess — the real audience of a folder', () => {
  it('a private folder with workspace and public items in its subtree reads as public', async () => {
    const fa = await queryFolderAccess(e, WS, 'fld_fat_board');
    expect(fa).toMatchObject({ visibility: 'private', effective: 'private', audience: 'public', access: 'public', moreOpen: { public: 1, workspace: 3 } });
    expect(fa!.openItems!.map((i) => i.id)).toEqual(['a4', 'dlv_fat_1', 'a2', 'a3']);
    expect(fa!.openItems![0]).toMatchObject({ kind: 'artifact', slug: 'fat-a4', visibility: 'public' });
  });

  it('a workspace folder only counts what is public; legacy unlisted is public', async () => {
    const fa = await queryFolderAccess(e, WS, 'fld_fat_team');
    expect(fa).toMatchObject({ effective: 'workspace', audience: 'public', access: 'public', moreOpen: { public: 1, workspace: 0 } });
    expect(fa!.openItems!.map((i) => i.id)).toEqual(['a7']);
  });

  it('a subfolder inherits private, and only its own subtree counts', async () => {
    const fa = await queryFolderAccess(e, WS, 'fld_fat_deep');
    expect(fa).toMatchObject({ visibility: 'inherit', effective: 'private', moreOpen: { public: 1, workspace: 1 } });
  });

  it('ignores deleted artifacts and files', async () => {
    const fa = await queryFolderAccess(e, WS, 'fld_fat_gone');
    expect(fa).toMatchObject({ effective: 'private', audience: 'private', access: 'private', moreOpen: { public: 0, workspace: 0 }, openItems: [] });
  });

  it('a personal folder reads as public when one of its artifacts is', async () => {
    const fa = await queryPersonalFolderAccess(e, [alice.id], 'fld_fat_mine');
    expect(fa).toMatchObject({ effective: 'private', audience: 'public', access: 'public', moreOpen: { public: 1, workspace: 0 } });
    expect(fa!.openItems!.map((i) => i.id)).toEqual(['p1']);
    expect(await queryPersonalFolderAccess(e, [member.id], 'fld_fat_mine')).toBeNull();
  });
});

describe('who sees which items', () => {
  const browse = (who: AuthUser, folder: string) =>
    handleHomeBrowserApi(new Request(`https://acme-fat.shareout.test/v1/home/browser?folder=${folder}`), e, who)
      .then((r) => r.json() as Promise<{ folderAccess: Record<string, unknown> | null; canEditFolder: boolean }>);

  it('a manager gets the items to fix', async () => {
    const body = await browse(admin, 'fld_fat_board');
    expect(body.canEditFolder).toBe(true);
    expect(body.folderAccess).toMatchObject({ access: 'public', moreOpen: { public: 1, workspace: 3 } });
    expect((body.folderAccess!.openItems as unknown[]).length).toBe(4);
  });

  it('a member who cannot manage the folder gets the truthful pill and counts, never names', async () => {
    const body = await browse(member, 'fld_fat_board');
    expect(body.canEditFolder).toBe(false);
    expect(body.folderAccess).toMatchObject({ access: 'public', moreOpen: { public: 1, workspace: 3 } });
    expect(body.folderAccess).not.toHaveProperty('openItems');
    expect(JSON.stringify(body)).not.toContain('fat-a4');
  });

  it('someone outside the workspace gets no access block at all', async () => {
    const body = await browse(alice, 'fld_fat_board');
    expect(body.folderAccess).toBeNull();
  });

  it('folder_access over MCP follows the same rule', async () => {
    const ctx = (user: AuthUser) => ({ env: e, user, origin: 'https://shareout.test', authorization: 'Bearer so_test' });
    const asMember = (await callTool(ctx(member), 'folder_access', { folder: 'Board', workspace_id: WS }))!;
    expect(asMember.content[0].text).toContain('anyone with the link');
    expect(asMember.content[0].text).toContain('1 item inside is public');
    expect(asMember.content[0].text).not.toContain('Page a4');
    expect(asMember.structuredContent).not.toHaveProperty('openItems');
    const asAdmin = (await callTool(ctx(admin), 'folder_access', { folder: 'Board', workspace_id: WS }))!;
    expect(asAdmin.content[0].text).toContain('https://shareout.test/a/fat-a4/');
  });
});
