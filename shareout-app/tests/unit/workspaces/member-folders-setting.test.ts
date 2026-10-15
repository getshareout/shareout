// members_can_create_folders: one workspace setting, admin-only to change, on by default.
import { describe, expect, it } from 'vitest';
import migrationSql from '../../../migrations/0011_member_folders.sql?raw';
import { handleUpdateWorkspace } from '../../../src/workspaces/crud';
import { handleGetWorkspace } from '../../../src/workspaces/read';
import type { AuthUser } from '../../../src/api-auth';
import type { Env, WorkspaceRole } from '../../../src/types';

const user = { id: 'usr_1', email: 'admin@example.com', username: null } as AuthUser;
const WS = 'wsp_1';

function makeEnv(role: WorkspaceRole, enabled = 1) {
  const runs: { sql: string; args: unknown[] }[] = [];
  const DB = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        async first() {
          if (sql.includes('SELECT role FROM workspace_members')) return { role };
          if (sql.includes('FROM workspaces w')) {
            return { id: WS, name: 'Team', slug: 'team', role, member_count: 2, member_folders_enabled: enabled };
          }
          return null;
        },
        async run() { runs.push({ sql, args }); return { success: true, meta: { changes: 1 } }; },
      }),
    }),
  };
  return { env: { DB } as unknown as Env, runs };
}

function patch(body: unknown) {
  return new Request(`https://shareout.example.com/v1/workspaces/${WS}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('members_can_create_folders', () => {
  it('is on by default for new and existing workspaces', () => {
    expect(migrationSql).toMatch(/ADD COLUMN member_folders_enabled INTEGER NOT NULL DEFAULT 1/);
  });

  it('is exposed as a boolean on GET /v1/workspaces/{id}', async () => {
    const { env } = makeEnv('member');
    const body = await (await handleGetWorkspace(new Request('https://x/'), env, user, WS)).json() as Record<string, unknown>;
    expect(body.members_can_create_folders).toBe(true);
    expect(body).not.toHaveProperty('member_folders_enabled');
  });

  it('cannot be changed by a member', async () => {
    const { env, runs } = makeEnv('member');
    const res = await handleUpdateWorkspace(patch({ members_can_create_folders: false }), env, user, WS);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'INSUFFICIENT_ROLE' });
    expect(runs).toHaveLength(0);
  });

  it('is turned off by an admin, and the change is audited', async () => {
    const { env, runs } = makeEnv('admin', 0);
    const res = await handleUpdateWorkspace(patch({ members_can_create_folders: false }), env, user, WS);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ members_can_create_folders: false });
    const update = runs.find((r) => r.sql.includes('UPDATE workspaces SET'));
    expect(update?.sql).toContain('member_folders_enabled = ?');
    expect(update?.args[0]).toBe(0);
    expect(runs.some((r) => r.sql.includes('INSERT INTO audit_log') && r.args.includes('workspace.member_folders_update'))).toBe(true);
  });

  it('rejects a non-boolean value', async () => {
    const { env, runs } = makeEnv('owner');
    const res = await handleUpdateWorkspace(patch({ members_can_create_folders: 'yes' }), env, user, WS);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'VALIDATION_ERROR', param: 'members_can_create_folders' });
    expect(runs).toHaveLength(0);
  });
});
