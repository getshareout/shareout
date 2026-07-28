import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/workspaces-invite-email', () => ({
  createInviteClaim: vi.fn(async () => 'ABCDE-FGHJK'),
  sendInviteEmail: vi.fn(async () => {}),
}));
vi.mock('../../../src/email/gateway', () => ({
  dispatchLifecycleEmail: vi.fn(async () => ({ sent: true })),
}));

import { inviteOrAddMember } from '../../../src/workspaces/invite';
import type { Env } from '../../../src/types';

interface Existing { role: string; member_class: string }

/** DB mock that reports one existing member edge and records every role UPDATE. */
function makeEnv(existing: Existing | null) {
  const roleUpdates: unknown[][] = [];
  const DB = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        async first() {
          if (sql.includes('FROM users WHERE email')) return { id: 'usr_target', last_login_at: '2026-01-01' };
          if (sql.includes('FROM workspace_members')) return existing ? { id: 'wsm_1', ...existing } : null;
          if (sql.includes('FROM workspaces WHERE id')) return { owner_id: 'usr_owner', name: 'WS' };
          return null;
        },
        async all() { return { results: [] }; },
        async run() {
          if (sql.includes('UPDATE workspace_members SET role')) roleUpdates.push(args);
          return { success: true, meta: { changes: 1 } };
        },
      }),
    }),
  };
  return { env: { DB } as unknown as Env, roleUpdates };
}

afterEach(() => vi.clearAllMocks());

describe('inviteOrAddMember role guards', () => {
  it('never demotes the workspace owner', async () => {
    // Otherwise any admin can POST the owner's email with role=member and take the
    // workspace: every gate reads workspace_members.role, not workspaces.owner_id.
    const { env, roleUpdates } = makeEnv({ role: 'owner', member_class: 'internal' });
    const res = await inviteOrAddMember(env, 'wsp_1', 'usr_admin', 'owner@example.com', 'member');
    expect(res.status).toBe('updated');
    expect(roleUpdates).toHaveLength(0);
  });

  it('does not downgrade an internal member added as a Sharee contact', async () => {
    // The Sharee path always passes role='member'; an existing internal admin must
    // keep their role.
    const { env, roleUpdates } = makeEnv({ role: 'admin', member_class: 'internal' });
    await inviteOrAddMember(env, 'wsp_1', 'usr_admin', 'lead@example.com', 'member', undefined, 'external');
    expect(roleUpdates).toHaveLength(0);
  });

  it('still applies an ordinary role change', async () => {
    const { env, roleUpdates } = makeEnv({ role: 'member', member_class: 'internal' });
    await inviteOrAddMember(env, 'wsp_1', 'usr_admin', 'dev@example.com', 'admin');
    expect(roleUpdates).toHaveLength(1);
    expect(roleUpdates[0][0]).toBe('admin');
  });
});
