// Folder managers (admins, or a folder's creator while members manage their folders)
// list, add and remove the grants on THAT folder; nobody else gets past the admin gate.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import type { AuthUser } from '../../../src/api-auth';
import { handleDeleteGrant, handleListGrants, handleShareWithPerson } from '../../../src/sharees/grants';
import { handleListFolderActivity } from '../../../src/sharees/activity';
import { invalidateGrants } from '../../../src/access/can-access';
import { queryFolderAccess } from '../../../src/pages/home/queries/folders';
import { setWorkspaceFlag } from '../../../src/features/flags';
import { EXTERNAL_SHARING_FEATURE } from '../../../src/sharees/guard';

const WS = 'wsp_fmg';
const u = (id: string, email: string) => ({ id, email, username: null } as AuthUser);
const admin = u('usr_fmg_admin', 'admin@example.com');
const creator = u('usr_fmg_creator', 'creator@example.com');
const member = u('usr_fmg_member', 'member@example.com');
const outsider = u('usr_fmg_ext', 'outsider@example.com');

const share = (who: AuthUser, folder: string, email = 'client@acme.test') =>
  handleShareWithPerson(new Request('https://x/', { method: 'POST', body: JSON.stringify({ resource_type: 'folder', resource_id: folder, email, capability: 'view' }) }), e, who, WS);
const list = (who: AuthUser, qs: string) => handleListGrants(new Request(`https://x/?${qs}`), e, who, WS);
const del = (who: AuthUser, id: string) => handleDeleteGrant(new Request('https://x/', { method: 'DELETE' }), e, who, WS, id);

async function grantOn(folder: string, id: string) {
  await e.DB.prepare("INSERT INTO grants (id, workspace_id, subject_type, subject_id, resource_type, resource_id, capability, granted_by) VALUES (?, ?, 'external_user', ?, 'folder', ?, 'view', ?)")
    .bind(id, WS, outsider.id, folder, admin.id).run();
}

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    ...[admin, creator, member, outsider].map((x) => e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(x.id, x.email, x.email.split('@')[0])),
    e.DB.prepare('INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, ?, ?, ?)').bind(WS, 'Acme', 'acme-fmg', admin.id),
    e.DB.prepare(`INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES
      ('wm_fmg_1', ?, ?, 'admin', 'internal'), ('wm_fmg_2', ?, ?, 'member', 'internal'),
      ('wm_fmg_3', ?, ?, 'member', 'internal'), ('wm_fmg_4', ?, ?, 'member', 'external')`)
      .bind(WS, admin.id, WS, creator.id, WS, member.id, WS, outsider.id),
    e.DB.prepare(`INSERT INTO folders (id, workspace_id, name, slug, parent_id, visibility, created_by) VALUES
      ('fld_fmg_root', ?, 'Clients', 'clients', NULL, 'public', ?),
      ('fld_fmg_mine', ?, 'Q3', 'q3', 'fld_fmg_root', 'inherit', ?),
      ('fld_fmg_other', ?, 'Board', 'board', NULL, 'private', ?)`)
      .bind(WS, admin.id, WS, creator.id, WS, admin.id),
  ]);
});

beforeEach(async () => {
  await e.DB.exec(`DELETE FROM grants WHERE workspace_id = '${WS}'`);
  await setWorkspaceFlag(e, WS, EXTERNAL_SHARING_FEATURE, null);
  await e.DB.prepare('UPDATE workspaces SET allowed_email_domains = NULL WHERE id = ?').bind(WS).run();
  await e.DB.prepare('UPDATE workspaces SET member_folders_enabled = 1 WHERE id = ?').bind(WS).run();
  await invalidateGrants(e, WS);
});

describe('grants on a folder — folder managers', () => {
  it("lets the folder's creator share it, list its grants and remove one", async () => {
    expect((await share(creator, 'fld_fmg_mine')).status).toBe(201);
    const res = await list(creator, 'resource_type=folder&resource_id=fld_fmg_mine');
    expect(res.status).toBe(200);
    const { grants } = await res.json() as { grants: { id: string; subject_label: string }[] };
    expect(grants.map((g) => g.subject_label)).toEqual(['client@acme.test']);
    expect((await del(creator, grants[0].id)).status).toBe(200);
    expect(await e.DB.prepare('SELECT COUNT(*) AS n FROM grants WHERE id = ?').bind(grants[0].id).first('n')).toBe(0);
  });

  it('denies a plain member on a folder they did not create', async () => {
    await grantOn('fld_fmg_mine', 'grt_fmg_1');
    expect((await share(member, 'fld_fmg_mine')).status).toBe(403);
    expect((await list(member, 'resource_type=folder&resource_id=fld_fmg_mine')).status).toBe(403);
    expect((await del(member, 'grt_fmg_1')).status).toBe(403);
    expect(await e.DB.prepare('SELECT COUNT(*) AS n FROM grants WHERE id = ?').bind('grt_fmg_1').first('n')).toBe(1);
  });

  it("denies the creator on another folder's grants, including its parent", async () => {
    await grantOn('fld_fmg_other', 'grt_fmg_2');
    await grantOn('fld_fmg_root', 'grt_fmg_3');
    expect((await del(creator, 'grt_fmg_2')).status).toBe(403);
    expect((await del(creator, 'grt_fmg_3')).status).toBe(403);
    expect((await list(creator, 'resource_type=folder&resource_id=fld_fmg_other')).status).toBe(403);
    expect((await list(creator, 'resource_type=folder')).status).toBe(403);
    expect((await share(creator, 'fld_fmg_other')).status).toBe(403);
  });

  it('denies the creator once members may no longer manage their folders', async () => {
    await e.DB.prepare('UPDATE workspaces SET member_folders_enabled = 0 WHERE id = ?').bind(WS).run();
    expect((await share(creator, 'fld_fmg_mine')).status).toBe(403);
    expect((await list(creator, 'resource_type=folder&resource_id=fld_fmg_mine')).status).toBe(403);
  });

  it('denies an external member, and answers 403 (not 404) for an unknown grant', async () => {
    expect((await list(outsider, 'resource_type=folder&resource_id=fld_fmg_mine')).status).toBe(403);
    expect((await del(member, 'grt_missing')).status).toBe(403);
    expect((await del(admin, 'grt_missing')).status).toBe(404);
  });

  it('keeps admins managing every grant', async () => {
    await grantOn('fld_fmg_other', 'grt_fmg_4');
    expect((await list(admin, '')).status).toBe(200);
    expect((await del(admin, 'grt_fmg_4')).status).toBe(200);
  });
});

// The folder-manager path relaxes only the role: the external-sharing entitlement and the
// workspace's email policy still apply to every share, while list and revoke stay open
// so access can always be wound down.
describe('grants on a folder — entitlement and policy', () => {
  const code = async (r: Response) => ((await r.json()) as { code?: string }).code;

  it('with external sharing off, neither the manager nor an admin can share', async () => {
    await setWorkspaceFlag(e, WS, EXTERNAL_SHARING_FEATURE, false);
    const byCreator = await share(creator, 'fld_fmg_mine', 'dave@acme.test');
    expect(byCreator.status).toBe(403);
    expect(await code(byCreator)).toBe('EXTERNAL_SHARING_NOT_ENTITLED');
    const byAdmin = await share(admin, 'fld_fmg_mine', 'dave@acme.test');
    expect(byAdmin.status).toBe(403);
    expect(await code(byAdmin)).toBe('EXTERNAL_SHARING_NOT_ENTITLED');
    expect(await e.DB.prepare("SELECT COUNT(*) AS n FROM grants WHERE resource_id = 'fld_fmg_mine'").first('n')).toBe(0);
    expect(await e.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE email = 'dave@acme.test'").first('n')).toBe(0);
  });

  it('with external sharing off, the manager can still list and revoke, and see activity', async () => {
    await grantOn('fld_fmg_mine', 'grt_fmg_off');
    await setWorkspaceFlag(e, WS, EXTERNAL_SHARING_FEATURE, false);
    expect((await list(creator, 'resource_type=folder&resource_id=fld_fmg_mine')).status).toBe(200);
    expect((await handleListFolderActivity(e, creator, WS, 'fld_fmg_mine')).status).toBe(200);
    expect((await del(creator, 'grt_fmg_off')).status).toBe(200);
    expect(await e.DB.prepare('SELECT COUNT(*) AS n FROM grants WHERE id = ?').bind('grt_fmg_off').first('n')).toBe(0);
  });

  it('with external sharing on, the manager can share', async () => {
    await setWorkspaceFlag(e, WS, EXTERNAL_SHARING_FEATURE, true);
    expect((await share(creator, 'fld_fmg_mine', 'bob@acme.test')).status).toBe(201);
  });

  it('a plain member is still refused on role first, whatever the entitlement', async () => {
    await setWorkspaceFlag(e, WS, EXTERNAL_SHARING_FEATURE, false);
    const r = await share(member, 'fld_fmg_mine');
    expect(r.status).toBe(403);
    expect(await code(r)).toBe('INSUFFICIENT_ROLE');
  });

  it("applies the workspace's allowed email domains to the manager's shares", async () => {
    await e.DB.prepare('UPDATE workspaces SET allowed_email_domains = ? WHERE id = ?').bind(JSON.stringify(['example.com']), WS).run();
    const r = await share(creator, 'fld_fmg_mine', 'carol@elsewhere.test');
    expect(r.status).toBe(403);
    expect(await code(r)).toBe('DOMAIN_NOT_ALLOWED');
    expect((await share(creator, 'fld_fmg_mine', 'outsider@example.com')).status).toBe(201);
    // An existing account outside the allowed domains gets no grant either.
    await e.DB.prepare('UPDATE workspaces SET allowed_email_domains = ? WHERE id = ?').bind(JSON.stringify(['acme.test']), WS).run();
    const blocked = await share(creator, 'fld_fmg_mine', 'outsider@example.com');
    expect(blocked.status).toBe(403);
  });
});

describe('queryFolderAccess', () => {
  it('resolves inherit from the nearest ancestor and lists inherited grants', async () => {
    await grantOn('fld_fmg_root', 'grt_fmg_5');
    const fa = await queryFolderAccess(e, WS, 'fld_fmg_mine');
    expect(fa).toMatchObject({ visibility: 'inherit', effective: 'public', access: 'public', inheritedFrom: { id: 'fld_fmg_root', name: 'Clients' } });
    expect(fa!.grants).toEqual([expect.objectContaining({ id: 'grt_fmg_5', subject_label: 'outsider@example.com', inherited: true, folder_name: 'Clients' })]);
  });

  it('labels a non-public folder with grants as shared externally, and one without as its visibility', async () => {
    expect((await queryFolderAccess(e, WS, 'fld_fmg_other'))!.access).toBe('private');
    await grantOn('fld_fmg_other', 'grt_fmg_6');
    const fa = await queryFolderAccess(e, WS, 'fld_fmg_other');
    expect(fa).toMatchObject({ effective: 'private', access: 'external', inheritedFrom: null });
    expect(fa!.grants[0]).toMatchObject({ inherited: false });
  });

  it('is null for a folder outside the workspace', async () => {
    expect(await queryFolderAccess(e, 'wsp_elsewhere', 'fld_fmg_mine')).toBeNull();
  });
});
