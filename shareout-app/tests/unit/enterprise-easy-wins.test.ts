import { afterEach, describe, expect, it, vi } from 'vitest';
import { logAudit, listWorkspaceAuditLog } from '../../src/audit';
import { handleGetWorkspaceAudit } from '../../src/router/api/workspace-audit';
import {
  handleGetWorkspaceSessionPolicy,
  handleSetWorkspaceSessionPolicy,
} from '../../src/router/api/workspace-session-policy';
import { resolveSessionMaxAge } from '../../src/auth';
import { handleGetWorkspace } from '../../src/workspaces';
import type { AuthUser } from '../../src/api-auth';
import type { Env, WorkspaceRole } from '../../src/types';

const admin: AuthUser = { id: 'usr_admin', email: 'admin@acme.co', username: null };
const workspaceId = 'wsp_1';
const baseEnv = {} as Env;
const DAY = 86_400;
const DEFAULT_MAX_AGE = 60 * 60 * 24 * 30;

function makeDbMock(handlers: {
  first?: (sql: string, ...bindArgs: unknown[]) => unknown;
  all?: (sql: string, ...bindArgs: unknown[]) => unknown;
  run?: (sql: string, ...bindArgs: unknown[]) => unknown;
} = {}): Env['DB'] {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...bindArgs: unknown[]) => ({
        first: vi.fn(async () => handlers.first?.(sql, ...bindArgs) ?? null),
        all: vi.fn(async () => handlers.all?.(sql, ...bindArgs) ?? { results: [] }),
        run: vi.fn(async () => handlers.run?.(sql, ...bindArgs) ?? { success: true, meta: { changes: 0 } }),
      })),
    })),
  } as unknown as Env['DB'];
}

function roleFirst(role: WorkspaceRole | null, extra?: (sql: string, ...args: unknown[]) => unknown) {
  return (sql: string, ...args: unknown[]) => {
    if (sql.includes('SELECT role FROM workspace_members')) return role ? { role } : null;
    return extra?.(sql, ...args) ?? null;
  };
}

afterEach(() => vi.restoreAllMocks());

describe('logAudit', () => {
  it('inserts a row with the action and detail', async () => {
    const run = vi.fn(() => ({ success: true }));
    const env = { ...baseEnv, DB: makeDbMock({ run }) };
    await logAudit(env, {
      workspaceId, actorId: 'usr_a', actorEmail: 'a@acme.co',
      action: 'member.remove', targetType: 'user', targetId: 'usr_b',
      detail: { removed_role: 'member' },
    });
    const insert = run.mock.calls.find((c) => String(c[0]).includes('INSERT INTO audit_log'));
    expect(insert).toBeTruthy();
    // binds: id, workspace_id, actor_id, actor_email, action, target_type, target_id, detail
    expect(insert?.[2]).toBe(workspaceId);
    expect(insert?.[5]).toBe('member.remove');
    expect(insert?.[8]).toBe(JSON.stringify({ removed_role: 'member' }));
  });

  it('never throws when the DB write fails', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({ run: () => { throw new Error('d1 down'); } }),
    };
    await expect(
      logAudit(env, { workspaceId, action: 'subdomain.enable' })
    ).resolves.toBeUndefined();
  });
});

describe('listWorkspaceAuditLog', () => {
  it('returns the stored rows', async () => {
    const rows = [{ id: 'a1', action: 'member.add' }];
    const env = { ...baseEnv, DB: makeDbMock({ all: () => ({ results: rows }) }) };
    expect(await listWorkspaceAuditLog(env, workspaceId)).toEqual(rows);
  });
});

describe('handleGetWorkspaceAudit', () => {
  const req = new Request('https://shareout.site/v1/workspaces/wsp_1/audit');

  it('requires admin', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst('member') }) };
    const res = await handleGetWorkspaceAudit(req, env, admin, workspaceId);
    expect(res.status).toBe(403);
  });

  it('returns parsed entries for an admin', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: roleFirst('admin'),
        all: (sql) => sql.includes('FROM audit_log')
          ? { results: [{ id: 'a1', ts: 't', actor_id: 'u', actor_email: 'u@x.co', action: 'member.add', target_type: 'email', target_id: 'x@x.co', detail: '{"role":"member"}' }] }
          : { results: [] },
      }),
    };
    const res = await handleGetWorkspaceAudit(req, env, admin, workspaceId);
    expect(res.status).toBe(200);
    const body = await res.json() as { entries: Array<{ action: string; detail: unknown }> };
    expect(body.entries[0].action).toBe('member.add');
    expect(body.entries[0].detail).toEqual({ role: 'member' });
  });
});

describe('seat visibility', () => {
  const req = new Request('https://shareout.site/v1/workspaces/wsp_1');
  const row = (members: number) => ({
    id: workspaceId, name: 'Acme', slug: 'acme', description: null,
    owner_id: 'usr_admin', created_at: 't', updated_at: null, role: 'owner',
    artifact_count: 0, folder_count: 0, member_count: members,
  });

  // The seat limit was only ever reported, never enforced on invite. Reporting a
  // cap of 3 told self-hosters — whose accounts all read as free — that their own
  // instance was capped, so the count is unlimited and honest now.
  it('reports unlimited seats', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: () => row(2) }) };
    const res = await handleGetWorkspace(req, env, admin, workspaceId);
    const body = await res.json() as { seats: { used: number; limit: number | null; remaining: number | null } };
    expect(body.seats).toEqual({ used: 2, limit: null, remaining: null });
  });

  it('counts members past the old cap', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: () => row(25) }) };
    const res = await handleGetWorkspace(req, env, admin, workspaceId);
    const body = await res.json() as { seats: { used: number; limit: number | null; remaining: number | null } };
    expect(body.seats).toEqual({ used: 25, limit: null, remaining: null });
  });
});

describe('resolveSessionMaxAge', () => {
  it('defaults to 30 days when no workspace sets a policy', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: () => ({ days: null }) }) };
    expect(await resolveSessionMaxAge(env, 'usr_a')).toBe(DEFAULT_MAX_AGE);
  });

  it('uses the strictest workspace policy', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: () => ({ days: 7 }) }) };
    expect(await resolveSessionMaxAge(env, 'usr_a')).toBe(7 * DAY);
  });

  it('never exceeds the platform default', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: () => ({ days: 999 }) }) };
    expect(await resolveSessionMaxAge(env, 'usr_a')).toBe(DEFAULT_MAX_AGE);
  });

  it('fails open to the default on a DB error', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: () => { throw new Error('down'); } }) };
    expect(await resolveSessionMaxAge(env, 'usr_a')).toBe(DEFAULT_MAX_AGE);
  });
});

describe('session policy endpoint', () => {
  function putReq(body: unknown): Request {
    return new Request('https://shareout.site/v1/workspaces/wsp_1/session-policy', {
      method: 'PUT', body: JSON.stringify(body),
    });
  }

  // admin role + an existing workspace. No plan check: gating this on the owner's
  // paid tier made a documented security control unreachable on self-host.
  function adminOnWorkspace() {
    return (sql: string) => {
      if (sql.includes('SELECT role FROM workspace_members')) return { role: 'admin' };
      if (sql.includes('FROM workspaces')) return { id: workspaceId };
      return null;
    };
  }

  it('reads the current policy for a member', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({ first: roleFirst('member', (sql) =>
        sql.includes('session_max_days') ? { session_max_days: 7 } : null) }),
    };
    const res = await handleGetWorkspaceSessionPolicy(env, admin, workspaceId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ session_max_days: 7, platform_default_days: 30, eligible: true });
  });

  it('requires admin to set', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst('member') }) };
    const res = await handleSetWorkspaceSessionPolicy(putReq({ session_max_days: 7 }), env, admin, workspaceId);
    expect(res.status).toBe(403);
  });

  it('404s when the workspace does not exist', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: roleFirst('admin') }) };
    const res = await handleSetWorkspaceSessionPolicy(putReq({ session_max_days: 7 }), env, admin, workspaceId);
    expect(res.status).toBe(404);
  });

  it('persists a valid value', async () => {
    const run = vi.fn(() => ({ success: true }));
    const env = { ...baseEnv, DB: makeDbMock({ first: adminOnWorkspace(), run }) };
    const res = await handleSetWorkspaceSessionPolicy(putReq({ session_max_days: 7 }), env, admin, workspaceId);
    expect(res.status).toBe(200);
    const upd = run.mock.calls.find((c) => String(c[0]).includes('UPDATE workspaces SET session_max_days'));
    expect(upd?.[1]).toBe(7);
  });

  it('accepts null to inherit the default', async () => {
    const run = vi.fn(() => ({ success: true }));
    const env = { ...baseEnv, DB: makeDbMock({ first: adminOnWorkspace(), run }) };
    const res = await handleSetWorkspaceSessionPolicy(putReq({ session_max_days: null }), env, admin, workspaceId);
    expect(res.status).toBe(200);
    const upd = run.mock.calls.find((c) => String(c[0]).includes('UPDATE workspaces SET session_max_days'));
    expect(upd?.[1]).toBeNull();
  });

  it('rejects out-of-range values', async () => {
    const env = { ...baseEnv, DB: makeDbMock({ first: adminOnWorkspace() }) };
    const res = await handleSetWorkspaceSessionPolicy(putReq({ session_max_days: 999 }), env, admin, workspaceId);
    expect(res.status).toBe(400);
    expect((await res.json() as { code: string }).code).toBe('VALIDATION_ERROR');
  });
});
