// A shared folder as a client portal: expiring person shares, "who opened what" for the
// folder's managers, view receipts on gated artifacts, and the branded folder landing.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import type { AuthUser } from '../../../src/api-auth';
import type { ArtifactInfo } from '../../../src/serve/types';

const who = vi.hoisted(() => ({ user: null as null | { id: string; email: string } }));
vi.mock('../../../src/auth/session', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSessionUser: vi.fn(async () => who.user),
}));
vi.mock('../../../src/account-links', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getVisibilityScope: vi.fn(async (_env: unknown, u: { id: string; email: string }) => ({ userIds: [u.id], emails: [u.email] })),
}));

import { handleShareWithPerson, parseShareExpiry } from '../../../src/sharees/grants';
import { canAccess, invalidateGrants } from '../../../src/access/can-access';
import { handleListFolderActivity } from '../../../src/sharees/activity';
import { checkAccess } from '../../../src/serve/access';
import { handleSharedPortal } from '../../../src/sharees/portal-page';
import { queryFolderAccess } from '../../../src/pages/home/queries/folders';

const WS = 'wsp_fcp';
const u = (id: string, email: string) => ({ id, email, username: null } as AuthUser);
const admin = u('usr_fcp_admin', 'admin@example.com');
const creator = u('usr_fcp_creator', 'creator@example.com');
const member = u('usr_fcp_member', 'member@example.com');
const client = u('usr_fcp_client', 'alice@acme.test');
const DAY = 86_400_000;

const share = (by: AuthUser, extra: Record<string, unknown> = {}, folder = 'fld_fcp_q3') =>
  handleShareWithPerson(new Request('https://x/', {
    method: 'POST',
    body: JSON.stringify({ resource_type: 'folder', resource_id: folder, email: client.email, capability: 'view', ...extra }),
  }), e, by, WS);
const grantRow = () => e.DB.prepare(
  "SELECT expires_at FROM grants WHERE subject_id = ? AND resource_id = 'fld_fcp_q3'",
).bind(client.id).first<{ expires_at: string | null }>();
const asClient = { userIds: [client.id], emails: [client.email] };

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    ...[admin, creator, member, client].map((x) => e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(x.id, x.email, x.email.split('@')[0])),
    e.DB.prepare('INSERT INTO workspaces (id, name, slug, owner_id, member_folders_enabled) VALUES (?, ?, ?, ?, 1)').bind(WS, 'Studio', 'studio-fcp', admin.id),
    e.DB.prepare(`INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES
      ('wm_fcp_1', ?, ?, 'admin', 'internal'), ('wm_fcp_2', ?, ?, 'member', 'internal'), ('wm_fcp_3', ?, ?, 'member', 'internal')`)
      .bind(WS, admin.id, WS, creator.id, WS, member.id),
    e.DB.prepare(`INSERT INTO folders (id, workspace_id, name, slug, parent_id, visibility, created_by) VALUES
      ('fld_fcp_q3', ?, 'Q3 reports', 'q3', NULL, 'private', ?),
      ('fld_fcp_sub', ?, 'Drafts', 'drafts', 'fld_fcp_q3', 'inherit', ?),
      ('fld_fcp_other', ?, 'Board', 'board', NULL, 'private', ?)`)
      .bind(WS, creator.id, WS, creator.id, WS, admin.id),
    e.DB.prepare(`INSERT INTO artifacts (id, workspace_id, folder_id, owner_id, name, slug, visibility) VALUES
      ('art_fcp_1', ?, 'fld_fcp_sub', ?, 'Revenue dashboard', 'fcp-revenue', 'private'),
      ('art_fcp_2', ?, 'fld_fcp_other', ?, 'Board deck', 'fcp-board', 'private')`)
      .bind(WS, admin.id, WS, admin.id),
    e.DB.prepare(`INSERT INTO sharees (id, workspace_id, name, slug, created_by, branding) VALUES
      ('shr_fcp', ?, 'Acme', 'acme', ?, ?)`).bind(WS, admin.id, JSON.stringify({ color: '#ff0066', logo: 'javascript:alert(1)' })),
  ]);
});

beforeEach(async () => {
  await e.DB.exec(`DELETE FROM grants WHERE workspace_id = '${WS}'`);
  await e.DB.exec(`DELETE FROM sharee_activity WHERE workspace_id = '${WS}'`);
  await e.DB.exec(`DELETE FROM sharee_members WHERE sharee_id = 'shr_fcp'`);
  await invalidateGrants(e, WS);
  who.user = null;
});
afterEach(() => { vi.useRealTimers(); });

describe('parseShareExpiry', () => {
  const now = Date.parse('2026-10-16T12:00:00.000Z');
  it('maps presets, dates and empties', () => {
    expect(parseShareExpiry({}, now)).toEqual({ expiresAt: null });
    expect(parseShareExpiry({ expires_in_days: 30 }, now)).toEqual({ expiresAt: '2026-11-15T12:00:00.000Z' });
    expect(parseShareExpiry({ expires_at: '2026-12-01' }, now)).toEqual({ expiresAt: '2026-12-01T23:59:59.999Z' });
    expect(parseShareExpiry({ expires_at: '2026-12-01T10:00:00Z' }, now)).toEqual({ expiresAt: '2026-12-01T10:00:00.000Z' });
  });
  it('rejects past, invalid and out-of-range values', () => {
    for (const b of [{ expires_at: '2026-10-01' }, { expires_at: 'soon' }, { expires_at: 5 }, { expires_in_days: 0 }, { expires_in_days: 1.5 }, { expires_in_days: 99999 }]) {
      expect('error' in parseShareExpiry(b, now)).toBe(true);
    }
  });
});

describe('expiring folder shares', () => {
  it('stores the expiry, shows it in the access panel, and the latest share wins', async () => {
    expect((await share(creator, { expires_in_days: 7 })).status).toBe(201);
    const exp = (await grantRow())!.expires_at!;
    expect(Math.abs(Date.parse(exp) - (Date.now() + 7 * DAY))).toBeLessThan(60_000);
    const fa = await queryFolderAccess(e, WS, 'fld_fcp_q3');
    expect(fa!.grants.map((g) => g.expires_at)).toEqual([exp]);

    expect((await share(creator)).status).toBe(201);
    expect((await grantRow())!.expires_at).toBeNull();
  });

  it('rejects a bad expiry with 400 and mints nothing', async () => {
    expect((await share(creator, { expires_at: '2001-01-01' })).status).toBe(400);
    expect(await grantRow()).toBeNull();
  });

  it('denies access after expiry, even from a context cached before it lapsed', async () => {
    await share(admin, { expires_in_days: 7 });
    expect(await canAccess(e, asClient, 'artifact', 'art_fcp_1', 'view')).toBe(true);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 8 * DAY);
    expect(await canAccess(e, asClient, 'artifact', 'art_fcp_1', 'view')).toBe(false);
    expect(await canAccess(e, asClient, 'folder', 'fld_fcp_q3', 'view')).toBe(false);
  });

  it('denies a grant already expired in the database', async () => {
    await share(admin);
    await e.DB.prepare("UPDATE grants SET expires_at = '2001-01-01T00:00:00.000Z' WHERE subject_id = ?").bind(client.id).run();
    await invalidateGrants(e, WS);
    expect(await canAccess(e, asClient, 'artifact', 'art_fcp_1', 'view')).toBe(false);
    expect((await queryFolderAccess(e, WS, 'fld_fcp_q3'))!.grants).toEqual([]);
  });
});

describe('who opened what — view receipts + folder activity', () => {
  const artifact = (over: Partial<ArtifactInfo>) => ({
    artifact_id: 'art_fcp_1', visibility: 'private', auth_method: 'google', owner_id: admin.id, ...over,
  } as ArtifactInfo);

  it('records an external view through a folder grant, even on a record without workspace_id', async () => {
    await share(admin);
    who.user = client;
    const rec = artifact({});
    delete (rec as Partial<ArtifactInfo>).workspace_id;
    expect(await checkAccess(new Request('https://x/a/fcp-revenue/'), e, 'fcp-revenue', rec)).toBeNull();

    const res = await handleListFolderActivity(e, creator, WS, 'fld_fcp_q3');
    expect(res.status).toBe(200);
    const { activity } = await res.json() as { activity: { user_email: string; resource_name: string; action: string }[] };
    expect(activity).toEqual([expect.objectContaining({ user_email: client.email, resource_name: 'Revenue dashboard', action: 'view' })]);
  });

  it("scopes a folder's activity to its subtree", async () => {
    await e.DB.prepare(`INSERT INTO sharee_activity (id, workspace_id, user_id, resource_type, resource_id, action)
      VALUES ('act_fcp_x', ?, ?, 'artifact', 'art_fcp_2', 'view')`).bind(WS, client.id).run();
    const { activity } = await (await handleListFolderActivity(e, admin, WS, 'fld_fcp_q3')).json() as { activity: unknown[] };
    expect(activity).toEqual([]);
    const other = await (await handleListFolderActivity(e, admin, WS, 'fld_fcp_other')).json() as { activity: unknown[] };
    expect(other.activity).toHaveLength(1);
  });

  it('limits folder activity to folder managers', async () => {
    expect((await handleListFolderActivity(e, admin, WS, 'fld_fcp_q3')).status).toBe(200);
    expect((await handleListFolderActivity(e, creator, WS, 'fld_fcp_q3')).status).toBe(200);
    expect((await handleListFolderActivity(e, member, WS, 'fld_fcp_q3')).status).toBe(403);
    expect((await handleListFolderActivity(e, creator, WS, 'fld_fcp_other')).status).toBe(403);
    expect((await handleListFolderActivity(e, client, WS, 'fld_fcp_q3')).status).toBe(403);
    expect((await handleListFolderActivity(e, admin, 'wsp_elsewhere', 'fld_fcp_q3')).status).toBe(403);
  });
});

describe('branded folder landing', () => {
  const portal = async (qs = '') => (await handleSharedPortal(new Request(`https://x/shared${qs}`), e))!.text();

  beforeEach(async () => {
    await e.DB.prepare("INSERT INTO grants (id, workspace_id, subject_type, subject_id, resource_type, resource_id, capability, granted_by) VALUES ('grt_fcp_b', ?, 'sharee', 'shr_fcp', 'folder', 'fld_fcp_q3', 'view', ?), ('grt_fcp_c', ?, 'external_user', ?, 'artifact', 'art_fcp_2', 'view', ?)")
      .bind(WS, admin.id, WS, client.id, admin.id).run();
    await e.DB.prepare("INSERT INTO sharee_members (id, sharee_id, user_id, email, status, invited_by) VALUES ('shm_fcp', 'shr_fcp', ?, ?, 'active', ?)")
      .bind(client.id, client.email, admin.id).run();
    who.user = client;
  });

  it('scopes to the folder and uses the org branding, dropping an unsafe logo', async () => {
    const html = await portal('?folder=fld_fcp_q3');
    expect(html).toContain('Acme · Q3 reports');
    expect(html).toContain('Revenue dashboard');
    expect(html).not.toContain('Board deck');
    expect(html).toContain('--color-primary: #ff0066');
    expect(html).not.toContain('javascript:');
  });

  it('renders the org and folder names as text in the page title', async () => {
    await e.DB.prepare("UPDATE folders SET name = ? WHERE id = 'fld_fcp_q3'").bind('</title><script>x()</script>').run();
    try {
      const html = await portal('?folder=fld_fcp_q3');
      expect(html).toContain('<title>Acme · &lt;/title&gt;&lt;script&gt;x()&lt;/script&gt;</title>');
      expect(html).not.toContain('<script>x()</script>');
    } finally {
      await e.DB.prepare("UPDATE folders SET name = 'Q3 reports' WHERE id = 'fld_fcp_q3'").run();
    }
  });

  it('falls back to the full portal for a folder the person was not granted', async () => {
    const html = await portal('?folder=fld_fcp_other');
    expect(html).not.toContain('Board</h1>');
    expect(html).toContain('Revenue dashboard');
    expect(html).toContain('Board deck');
  });
});
