// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Env } from '../../../src/types';

const { createWorkspaceForUser, inviteOrAddMember, logAudit } = vi.hoisted(() => ({
  createWorkspaceForUser: vi.fn(),
  inviteOrAddMember: vi.fn(),
  logAudit: vi.fn(),
}));

vi.mock('../../../src/workspaces/crud', () => ({ createWorkspaceForUser }));
vi.mock('../../../src/workspaces/invite', () => ({ inviteOrAddMember }));
vi.mock('../../../src/audit', () => ({ logAudit }));

import { provisionWorkspace, setWorkspaceMemberRole } from '../../../src/superadmin/workspaces-provision';

const actor = { id: 'usr_admin', email: 'owner@instance.test' };

interface Plan {
  first?: (sql: string, args: unknown[]) => unknown;
}

function makeEnv(plan: Plan = {}): { env: Env; inserts: Array<{ sql: string; args: unknown[] }> } {
  const inserts: Array<{ sql: string; args: unknown[] }> = [];
  const env = {
    DB: {
      prepare: (sql: string) => ({
        bind: (...args: unknown[]) => ({
          first: async () => plan.first?.(sql, args) ?? null,
          run: async () => {
            inserts.push({ sql: sql.replace(/\s+/g, ' ').trim(), args });
            return { success: true };
          },
        }),
      }),
    },
  } as unknown as Env;
  return { env, inserts };
}

beforeEach(() => {
  vi.clearAllMocks();
  createWorkspaceForUser.mockResolvedValue({ id: 'wsp_1', name: 'Marketing', slug: 'marketing', description: null });
  inviteOrAddMember.mockResolvedValue({ email: 'ana@acme.test', status: 'added' });
});

describe('provisionWorkspace', () => {
  // The instance owner should be able to stand up "marketing's workspace, owned by
  // ana@" before Ana has ever opened the product. She lands in it on first sign-in.
  it('creates the owner when they have never signed in', async () => {
    const { env, inserts } = makeEnv({ first: () => null });
    const res = await provisionWorkspace(env, actor, { name: 'Marketing', owner_email: 'Ana@Acme.test' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id: 'wsp_1', slug: 'marketing', owner_email: 'ana@acme.test' });
    expect(inserts.some((i) => i.sql.includes('INSERT INTO users'))).toBe(true);
    expect(createWorkspaceForUser).toHaveBeenCalledOnce();
  });

  it('reuses an existing owner instead of creating a second row', async () => {
    const { env, inserts } = makeEnv({
      first: (sql) => (sql.includes('FROM users') ? { id: 'usr_ana', email: 'ana@acme.test' } : null),
    });
    await provisionWorkspace(env, actor, { name: 'Marketing', owner_email: 'ana@acme.test' });

    expect(inserts.some((i) => i.sql.includes('INSERT INTO users'))).toBe(false);
    expect(createWorkspaceForUser.mock.calls[0][1]).toMatchObject({ id: 'usr_ana' });
  });

  it('records who provisioned it', async () => {
    const { env } = makeEnv({ first: () => null });
    await provisionWorkspace(env, actor, { name: 'Marketing', owner_email: 'ana@acme.test' });

    expect(logAudit).toHaveBeenCalledWith(env, expect.objectContaining({
      action: 'workspace.provision',
      actorEmail: 'owner@instance.test',
    }));
  });

  it('rejects a missing name, a missing owner, and a bad slug', async () => {
    const { env } = makeEnv({ first: () => null });
    expect((await provisionWorkspace(env, actor, { owner_email: 'a@b.test' })).status).toBe(400);
    expect((await provisionWorkspace(env, actor, { name: 'X' })).status).toBe(400);
    expect((await provisionWorkspace(env, actor, { name: 'X', owner_email: 'a@b.test', slug: 'Not Valid' })).status).toBe(400);
    expect(createWorkspaceForUser).not.toHaveBeenCalled();
  });

  it('409s on a taken slug', async () => {
    const { env } = makeEnv({ first: (sql) => (sql.includes('FROM workspaces') ? { id: 'wsp_x' } : null) });
    const res = await provisionWorkspace(env, actor, { name: 'Marketing', owner_email: 'a@b.test' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('SLUG_TAKEN');
  });
});

describe('setWorkspaceMemberRole', () => {
  // The caller is an instance admin, not necessarily a member of this workspace —
  // that is exactly the gap this closes.
  it('sets a role in a workspace the actor does not belong to', async () => {
    const { env } = makeEnv({ first: (sql) => (sql.includes('FROM workspaces') ? { id: 'wsp_1', name: 'Marketing' } : null) });
    const res = await setWorkspaceMemberRole(env, actor, 'wsp_1', { email: 'Ana@Acme.test', role: 'admin' });

    expect(res.status).toBe(200);
    expect(inviteOrAddMember).toHaveBeenCalledWith(env, 'wsp_1', actor.id, 'ana@acme.test', 'admin');
    expect(logAudit).toHaveBeenCalledWith(env, expect.objectContaining({ action: 'workspace.member_role_set' }));
  });

  it('rejects an unknown role', async () => {
    const { env } = makeEnv({ first: () => ({ id: 'wsp_1', name: 'Marketing' }) });
    const res = await setWorkspaceMemberRole(env, actor, 'wsp_1', { email: 'a@b.test', role: 'superuser' });
    expect(res.status).toBe(400);
    expect(inviteOrAddMember).not.toHaveBeenCalled();
  });

  it('404s for a workspace that does not exist', async () => {
    const { env } = makeEnv({ first: () => null });
    const res = await setWorkspaceMemberRole(env, actor, 'wsp_missing', { email: 'a@b.test', role: 'member' });
    expect(res.status).toBe(404);
    expect(inviteOrAddMember).not.toHaveBeenCalled();
  });
});
