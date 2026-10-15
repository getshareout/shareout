// @vitest-environment node
// "Ask an admin": a member refused by a role gate pings the workspace's owners/admins
// (bell row + email), deduped per reason. Runs against the real migrated schema.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const dispatchMock = vi.fn(async () => ({ sent: true }));
vi.mock('../../../src/email/gateway', () => ({ dispatchLifecycleEmail: (...a: unknown[]) => dispatchMock(...(a as [])) }));

import { applyMigrations, e } from '../helpers/migrated-db';
import { handleCreateAdminRequest } from '../../../src/workspaces/admin-requests';
import { queryNeedsYou } from '../../../src/pages/home/queries/activity-needs-you';
import { buildEmail } from '../../../src/email/catalog-es';

const WS = 'wsp_askadm';
const owner = { id: 'usr_ask_owner', email: 'owner@example.com', username: null };
const admin = { id: 'usr_ask_admin', email: 'admin@example.com', username: null };
const member = { id: 'usr_ask_member', email: 'member@example.com', username: null };
const outsider = { id: 'usr_ask_out', email: 'out@example.com', username: null };

const post = (body: unknown) =>
  new Request(`https://shareout.test/v1/workspaces/${WS}/admin-requests`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    ...[owner, admin, member, outsider].map((u, i) =>
      e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(u.id, u.email, ['Owner', 'Admin', 'Sam Member', 'Out'][i])),
    e.DB.prepare('INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, ?, ?, ?)').bind(WS, 'Team Space', 'team-space-ask', owner.id),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES ('wm_1', ?, ?, 'owner'), ('wm_2', ?, ?, 'admin'), ('wm_3', ?, ?, 'member')")
      .bind(WS, owner.id, WS, admin.id, WS, member.id),
    e.DB.prepare('INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, ?, ?, ?)').bind('wsp_solo', 'Solo', 'solo-ask', owner.id),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES ('wm_4', 'wsp_solo', ?, 'owner')").bind(owner.id),
  ]);
});

beforeEach(async () => {
  dispatchMock.mockClear();
  await e.DB.exec("DELETE FROM notifications WHERE kind = 'admin_request'");
});

describe('POST /v1/workspaces/:id/admin-requests', () => {
  it('notifies every owner/admin in-app and by email, then confirms', async () => {
    const res = await handleCreateAdminRequest(post({ code: 'ADMIN_REQUIRED', action: "Couldn't create the folder.", message: 'Only workspace admins can create Team Space folders' }), e, member, WS);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: 'sent', notified: 2 });

    const rows = await e.DB.prepare("SELECT recipient_id, subject_id, message, payload FROM notifications WHERE kind = 'admin_request' ORDER BY recipient_id")
      .all<{ recipient_id: string; subject_id: string; message: string; payload: string }>();
    expect(rows.results.map((r) => r.recipient_id)).toEqual([admin.id, owner.id]);
    expect(rows.results[0]).toMatchObject({ subject_id: WS, message: "Couldn't create the folder." });
    expect(JSON.parse(rows.results[0].payload)).toMatchObject({ requester_id: member.id, requester_name: 'Sam Member', code: 'ADMIN_REQUIRED' });

    expect(dispatchMock).toHaveBeenCalledTimes(2);
    expect(dispatchMock).toHaveBeenCalledWith(e, expect.objectContaining({
      type: 'admin_request', workspaceId: WS,
      data: expect.objectContaining({ requesterName: 'Sam Member', workspaceName: 'Team Space', action: "Couldn't create the folder." }),
    }));
  });

  it('shows up in the admin’s Needs You, scoped to that workspace', async () => {
    await handleCreateAdminRequest(post({ code: 'ADMIN_REQUIRED', action: "Couldn't create the folder.", message: 'Only admins' }), e, member, WS);
    const rows = await queryNeedsYou(e, { id: admin.id, email: admin.email }, { workspaceId: WS });
    const ask = rows.find((r) => r.kind === 'admin_request');
    expect(ask).toMatchObject({ actor: 'Sam Member', summary: "needs an admin: Couldn't create the folder.", artifact_name: 'Only admins' });
    const elsewhere = await queryNeedsYou(e, { id: admin.id, email: admin.email }, { workspaceId: 'wsp_other' });
    expect(elsewhere.some((r) => r.kind === 'admin_request')).toBe(false);
  });

  it('a repeat ask for the same reason within a day re-notifies nobody', async () => {
    await handleCreateAdminRequest(post({ code: 'ADMIN_REQUIRED', action: 'x' }), e, member, WS);
    dispatchMock.mockClear();
    const again = await handleCreateAdminRequest(post({ code: 'ADMIN_REQUIRED', action: 'x' }), e, member, WS);
    expect(await again.json()).toEqual({ ok: true, status: 'pending' });
    expect(dispatchMock).not.toHaveBeenCalled();
    const n = await e.DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'admin_request'").first<{ n: number }>();
    expect(n?.n).toBe(2);
  });

  it('refuses non-members and bad JSON with the standard envelope', async () => {
    const out = await handleCreateAdminRequest(post({ code: 'ADMIN_REQUIRED' }), e, outsider, WS);
    expect(out.status).toBe(403);
    expect(await out.json()).toMatchObject({ success: false, code: 'FORBIDDEN' });
    const bad = await handleCreateAdminRequest(post('{nope'), e, member, WS);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ success: false, code: 'INVALID_JSON' });
  });

  it('says so when there is nobody else to ask, and normalizes an unknown code', async () => {
    const solo = await handleCreateAdminRequest(post({ code: 'ADMIN_REQUIRED' }), e, owner, 'wsp_solo');
    expect(solo.status).toBe(409);
    expect(await solo.json()).toMatchObject({ success: false, code: 'NO_ADMINS' });
    const res = await handleCreateAdminRequest(post({ code: 'not a code!', action: 'y' }), e, member, WS);
    expect(res.status).toBe(200);
    const row = await e.DB.prepare("SELECT payload FROM notifications WHERE kind = 'admin_request' LIMIT 1").first<{ payload: string }>();
    expect(JSON.parse(row!.payload).code).toBe('FORBIDDEN');
  });
});

describe('admin_request email copy', () => {
  const ctx = { env: e, baseUrl: 'https://shareout.test' };
  const data = { requesterName: 'Sam', workspaceName: 'Team Space', action: "Couldn't create the folder.", reason: 'Only admins', url: 'https://shareout.test/home' };

  it('English names who asked, what they tried, and links home', () => {
    const out = buildEmail('admin_request', data, ctx)!;
    expect(out.subject).toBe('Sam needs an admin in Team Space');
    expect(out.bodyHtml).toContain('What they tried');
    expect(out.cta?.href).toBe('https://shareout.test/home');
  });

  it('Spanish uses voseo', () => {
    const out = buildEmail('admin_request', data, { ...ctx, locale: 'es' })!;
    expect(out.subject).toBe('Sam necesita a un admin en Team Space');
    expect(out.bodyHtml).toContain('Podés hacerlo vos');
  });
});
