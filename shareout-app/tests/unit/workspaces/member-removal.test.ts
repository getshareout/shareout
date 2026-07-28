import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/audit', () => ({ logAudit: vi.fn(async () => {}) }));

import { handleRemoveWorkspaceMember, handleTransferWorkspaceOwnership } from '../../../src/workspaces';
import type { AuthUser } from '../../../src/api-auth';
import type { Env } from '../../../src/types';

const actor: AuthUser = { id: 'usr_admin', email: 'admin@example.com', username: null };
const workspaceId = 'wsp_1';

function makeEnv(opts: { actorRole?: string; targetRole?: string | null; targetIsInternal?: boolean }) {
  const batched: string[] = [];
  const DB = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        async first() {
          if (sql.includes("member_class = 'internal'") && sql.includes('SELECT id FROM workspace_members')) {
            return opts.targetIsInternal ? { id: 'wsm_2' } : null;
          }
          if (sql.includes('SELECT role FROM workspace_members')) {
            // roles.ts resolves the ACTOR; members.ts resolves the target.
            return args[1] === actor.id
              ? { role: opts.actorRole ?? 'admin' }
              : (opts.targetRole ? { role: opts.targetRole } : null);
          }
          return null;
        },
        async all() { return { results: [] }; },
        async run() { return { success: true, meta: { changes: 1 } }; },
        _sql: sql,
      }),
    }),
    batch: vi.fn(async (stmts: Array<{ _sql: string }>) => {
      batched.push(...stmts.map((s) => s._sql));
      return [];
    }),
  };
  return { env: { DB } as unknown as Env, batched };
}

afterEach(() => vi.clearAllMocks());

describe('handleRemoveWorkspaceMember', () => {
  it('revokes the sharee link and grants, not just the membership edge', async () => {
    // canAccess resolves external access through sharee_members + grants, neither of
    // which references workspace_members — deleting only the edge leaves a removed
    // client with every deliverable they were granted.
    const { env, batched } = makeEnv({ targetRole: 'member' });
    const res = await handleRemoveWorkspaceMember(
      new Request('https://x', { method: 'DELETE' }), env, actor, workspaceId, 'usr_2');

    expect(res.status).toBe(200);
    expect(batched.some((s) => s.includes('DELETE FROM workspace_members'))).toBe(true);
    expect(batched.some((s) => s.includes('DELETE FROM sharee_members'))).toBe(true);
    expect(batched.some((s) => s.includes('DELETE FROM grants'))).toBe(true);
  });

  it('still refuses to remove the owner', async () => {
    const { env, batched } = makeEnv({ targetRole: 'owner' });
    const res = await handleRemoveWorkspaceMember(
      new Request('https://x', { method: 'DELETE' }), env, actor, workspaceId, 'usr_owner');
    expect(res.status).toBe(400);
    expect(batched).toHaveLength(0);
  });
});

describe('handleTransferWorkspaceOwnership', () => {
  function transfer(env: Env, targetId: string) {
    return handleTransferWorkspaceOwnership(
      new Request('https://x', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: targetId }),
      }), env, actor, workspaceId);
  }

  it('refuses to hand the workspace to an external (Sharee) member', async () => {
    const { env, batched } = makeEnv({ actorRole: 'owner', targetIsInternal: false });
    const res = await transfer(env, 'usr_client');
    expect(res.status).toBe(400);
    expect((await res.json() as { code: string }).code).toBe('NOT_MEMBER');
    expect(batched).toHaveLength(0);
  });

  it('transfers to an internal member in one batch', async () => {
    const { env, batched } = makeEnv({ actorRole: 'owner', targetIsInternal: true });
    const res = await transfer(env, 'usr_2');
    expect(res.status).toBe(200);
    expect(batched).toHaveLength(3);
  });
});
