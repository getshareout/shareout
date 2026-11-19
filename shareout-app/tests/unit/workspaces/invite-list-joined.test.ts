// The pending-invites list (Members view, attention badge, MCP list_members) against the
// real schema. The member row exists from invite time, so signing in any way at all is
// joining: someone who never redeemed the emailed code must not stay "waiting to accept".
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import { handleListWorkspaceInvites } from '../../../src/workspaces/invites-admin';
import type { AuthUser } from '../../../src/api-auth';

const WS = 'wsp_ivj';
const OWNER = 'usr_ivj_owner';
const owner: AuthUser = { id: OWNER, email: 'owner@acme.test', username: 'owner' };

// [user, email, last sign-in, invite sent, code redeemed, still a member]
const PEOPLE: Array<[string, string, string | null, string, string | null, boolean]> = [
  ['usr_ivj_never', 'never@acme.test', null, '2026-11-01T10:00:00.000Z', null, true],
  ['usr_ivj_google', 'google@acme.test', '2026-11-02T09:00:00.000Z', '2026-09-21T18:00:00.000Z', null, true],
  ['usr_ivj_before', 'before@acme.test', '2026-08-01T09:00:00.000Z', '2026-11-05T12:00:00.000Z', null, true],
  ['usr_ivj_link', 'link@acme.test', '2026-10-01T09:00:00.000Z', '2026-10-01T08:00:00.000Z', '2026-10-01T09:00:01.000Z', true],
  ['usr_ivj_removed', 'removed@acme.test', null, '2026-10-12T17:00:00.000Z', null, false],
];

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES (?, 'owner@acme.test', 'owner')").bind(OWNER),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'Acme', 'acme-ivj', ?)").bind(WS, OWNER),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES ('wm_ivj_owner', ?, ?, 'owner')").bind(WS, OWNER),
    ...PEOPLE.flatMap(([id, email, login, sent, claimed, member]) => [
      e.DB.prepare('INSERT INTO users (id, email, name, last_login_at) VALUES (?, ?, ?, ?)').bind(id, email, email.split('@')[0], login),
      e.DB.prepare(
        `INSERT INTO workspace_invite_claims (id, workspace_id, user_id, email, code_hash, invited_by, created_at, expires_at, claimed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, '2026-12-31T00:00:00.000Z', ?)`
      ).bind(`inv_${id}`, WS, id, email, `hash_${id}`, OWNER, sent, claimed),
      ...(member
        ? [e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES (?, ?, ?, 'admin')").bind(`wm_${id}`, WS, id)]
        : []),
    ]),
  ]);
});

describe('pending workspace invites', () => {
  it('lists only members who have not signed in since they were invited', async () => {
    const res = await handleListWorkspaceInvites(e, owner, WS);
    expect(res.status).toBe(200);
    const { invites } = await res.json<{ invites: Array<{ email: string }> }>();
    // google: signed in without the link. link: redeemed it. removed: no longer a member.
    expect(invites.map((i) => i.email).sort()).toEqual(['before@acme.test', 'never@acme.test']);
  });
});
