import { describe, expect, it, vi } from 'vitest';
import { resolveArtifactAccessForUser } from '../../../src/chat-agent/access';
import type { Env } from '../../../src/types';

type FirstFn = (sql: string, ...binds: unknown[]) => unknown;

function makeDb(first: FirstFn): Env['DB'] {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...binds: unknown[]) => ({
        first: vi.fn(async () => first(sql, ...binds) ?? null),
        all: vi.fn(async () => ({ results: [] })),
      })),
    })),
  } as unknown as Env['DB'];
}

const POLICY = JSON.stringify({
  version: 1,
  field: 'company_id',
  default: 'deny',
  rules: [{ match: { email: 'viewer@x.com' }, values: [1, 2] }],
});

describe('resolveArtifactAccessForUser', () => {
  it('grants owner full access with no row filter', async () => {
    const env = { DB: makeDb((sql) => {
      if (sql.includes('FROM artifacts')) return { owner_id: 'usr_1', workspace_id: null, visibility: 'private', access_policy: null };
      return null;
    }) } as Env;

    const access = await resolveArtifactAccessForUser(env, 'art_1', 'usr_1');
    expect(access).not.toBeNull();
    expect(access!.role).toBe('owner');
    expect(access!.viewerScope).toBeNull();
    expect(access!.canRunConnections).toBe(true);
  });

  it('denies a stranger to a private artifact', async () => {
    const env = { DB: makeDb((sql) => {
      if (sql.includes('FROM artifacts')) return { owner_id: 'usr_owner', workspace_id: null, visibility: 'private', access_policy: null };
      if (sql.includes('FROM users')) return { email: 'stranger@x.com' };
      return null; // no collaborator row
    }) } as Env;

    await expect(resolveArtifactAccessForUser(env, 'art_1', 'usr_x')).resolves.toBeNull();
  });

  it('gives a collaborator the row-level scope and no connection access when not a member', async () => {
    const env = { DB: makeDb((sql) => {
      if (sql.includes('FROM artifacts')) return { owner_id: 'usr_owner', workspace_id: null, visibility: 'private', access_policy: POLICY };
      if (sql.includes('FROM users')) return { email: 'viewer@x.com' };
      if (sql.includes('FROM collaborators')) return { role: 'viewer' };
      return null;
    }) } as Env;

    const access = await resolveArtifactAccessForUser(env, 'art_1', 'usr_2');
    expect(access!.role).toBe('viewer');
    expect(access!.viewerScope).toEqual({ field: 'company_id', values: [1, 2] });
    expect(access!.canRunConnections).toBe(false);
  });

  it('grants a workspace member access to a workspace-visible artifact and lets them run connections', async () => {
    const env = { DB: makeDb((sql) => {
      if (sql.includes('FROM artifacts')) return { owner_id: 'usr_owner', workspace_id: 'ws_1', visibility: 'workspace', access_policy: null };
      if (sql.includes('FROM workspace_members')) return { role: 'member' };
      if (sql.includes('FROM users')) return { email: 'member@x.com' };
      return null; // no explicit collaborator row
    }) } as Env;

    const access = await resolveArtifactAccessForUser(env, 'art_1', 'usr_3');
    expect(access!.role).toBe('viewer');
    expect(access!.isWorkspaceMember).toBe(true);
    expect(access!.canRunConnections).toBe(true);
  });

  it('denies a non-member to a private artifact in a workspace they are not in', async () => {
    const env = { DB: makeDb((sql) => {
      if (sql.includes('FROM artifacts')) return { owner_id: 'usr_owner', workspace_id: 'ws_1', visibility: 'private', access_policy: null };
      if (sql.includes('FROM workspace_members')) return null;
      if (sql.includes('FROM users')) return { email: 'stranger@x.com' };
      return null;
    }) } as Env;

    await expect(resolveArtifactAccessForUser(env, 'art_1', 'usr_4')).resolves.toBeNull();
  });
});
