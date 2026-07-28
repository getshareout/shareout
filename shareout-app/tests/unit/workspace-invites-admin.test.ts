import { afterEach, describe, expect, it, vi } from 'vitest';

// work/030 sweep: code now calls getInternalWorkspaceRole; alias both exports to one
// mock fn so vi.mocked(getWorkspaceRole).mockResolvedValue(...) drives the real path.
const wsRoleMock = vi.hoisted(() => vi.fn());
vi.mock('../../src/workspaces', async (orig) => {
  const actual = await orig<typeof import('../../src/workspaces')>();
  return { ...actual, getWorkspaceRole: wsRoleMock, getInternalWorkspaceRole: wsRoleMock, invalidateWorkspaceRole: vi.fn(async () => {}) };
});
vi.mock('../../src/workspaces-invite-email', () => ({
  createInviteClaim: vi.fn(async () => 'CODE123'),
  sendInviteEmail: vi.fn(async () => {}),
}));
vi.mock('../../src/audit', () => ({ logAudit: vi.fn(async () => {}) }));

import {
  handleListWorkspaceInvites,
  handleResendWorkspaceInvite,
  handleRevokeWorkspaceInvite,
} from '../../src/workspaces/invites-admin';
import { getWorkspaceRole } from '../../src/workspaces';
import { createInviteClaim, sendInviteEmail } from '../../src/workspaces-invite-email';
import type { Env } from '../../src/types';
import type { AuthUser } from '../../src/api-auth';

const admin: AuthUser = { id: 'usr_1', email: 'admin@example.com', username: 'admin' };
const wsId = 'wsp_x';

/** Resend is a POST; body carries the optional `notify` flag. */
function req(body?: unknown): Request {
  return new Request('https://acme.example/v1/workspaces/wsp_x/invites/inv_1/resend', {
    method: 'POST',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

function dbMock(opts: { first?: unknown; runSpy?: (sql: string) => void } = {}): Env['DB'] {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => opts.first ?? null),
        all: vi.fn(async () => ({ results: [] })),
        run: vi.fn(async () => { opts.runSpy?.(sql); return { success: true }; }),
      })),
    })),
  } as unknown as Env['DB'];
}

afterEach(() => vi.clearAllMocks());

describe('workspace invites admin', () => {
  it('forbids non-admin from listing invites', async () => {
    vi.mocked(getWorkspaceRole).mockResolvedValue('member');
    const res = await handleListWorkspaceInvites({ DB: dbMock() } as Env, admin, wsId);
    expect(res.status).toBe(403);
  });

  it('resend regenerates a code and emails it', async () => {
    vi.mocked(getWorkspaceRole).mockResolvedValue('owner');
    const env = { DB: dbMock({ first: { user_id: 'usr_2', email: 'p@e.com' } }) } as Env;
    const res = await handleResendWorkspaceInvite(req(), env, admin, wsId, 'inv_1');
    expect(res.status).toBe(200);
    expect(createInviteClaim).toHaveBeenCalledWith(env, wsId, 'usr_2', 'p@e.com', 'usr_1');
    expect(sendInviteEmail).toHaveBeenCalled();
  });

  // The claim code is hashed at rest, so an instance with no EMAIL binding had no way to
  // reach a pending invite at all. The join URL in the response is that way.
  it('returns a join URL on this instance origin, not the hosted one', async () => {
    vi.mocked(getWorkspaceRole).mockResolvedValue('owner');
    const env = { DB: dbMock({ first: { user_id: 'usr_2', email: 'p@e.com' } }), SHAREOUT_BASE_URL: 'https://acme.example' } as unknown as Env;
    const res = await handleResendWorkspaceInvite(req(), env, admin, wsId, 'inv_1');
    expect(await res.json()).toEqual({ ok: true, inviteUrl: 'https://acme.example/invite/CODE123' });
  });

  it('notify:false mints a link without emailing the invitee', async () => {
    vi.mocked(getWorkspaceRole).mockResolvedValue('owner');
    const env = { DB: dbMock({ first: { user_id: 'usr_2', email: 'p@e.com' } }), SHAREOUT_BASE_URL: 'https://acme.example' } as unknown as Env;
    const res = await handleResendWorkspaceInvite(req({ notify: false }), env, admin, wsId, 'inv_1');
    expect(res.status).toBe(200);
    expect(createInviteClaim).toHaveBeenCalled();
    expect(sendInviteEmail).not.toHaveBeenCalled();
    expect((await res.json<{ inviteUrl: string }>()).inviteUrl).toBe('https://acme.example/invite/CODE123');
  });

  it('resend 404s when no pending invite matches', async () => {
    vi.mocked(getWorkspaceRole).mockResolvedValue('admin');
    const res = await handleResendWorkspaceInvite(req(), { DB: dbMock({ first: null }) } as Env, admin, wsId, 'inv_x');
    expect(res.status).toBe(404);
    expect(createInviteClaim).not.toHaveBeenCalled();
  });

  it('revoke deletes claim + member rows for a pending invite', async () => {
    vi.mocked(getWorkspaceRole).mockResolvedValue('owner');
    const deletes: string[] = [];
    const env = { DB: dbMock({ first: { user_id: 'usr_2', email: 'p@e.com', claimed_at: null }, runSpy: (s) => deletes.push(s) }) } as Env;
    const res = await handleRevokeWorkspaceInvite(env, admin, wsId, 'inv_1');
    expect(res.status).toBe(200);
    expect(deletes.some((s) => /DELETE FROM workspace_invite_claims/.test(s))).toBe(true);
    expect(deletes.some((s) => /DELETE FROM workspace_members/.test(s))).toBe(true);
  });

  it('revoke refuses an already-claimed invite', async () => {
    vi.mocked(getWorkspaceRole).mockResolvedValue('owner');
    const res = await handleRevokeWorkspaceInvite(
      { DB: dbMock({ first: { user_id: 'usr_2', email: 'p@e.com', claimed_at: '2026-01-01' } }) } as Env,
      admin, wsId, 'inv_1'
    );
    expect(res.status).toBe(400);
  });
});
