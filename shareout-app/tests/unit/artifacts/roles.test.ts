import { describe, expect, it, vi } from 'vitest';
import { getUserRole, requireRole } from '../../../src/artifacts/roles';
import type { Env } from '../../../src/types';

function makeDbMock(handlers: {
  first?: (sql: string, ...bindArgs: unknown[]) => unknown;
}): Env['DB'] {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...bindArgs: unknown[]) => ({
        first: vi.fn(async () => handlers.first?.(sql, ...bindArgs) ?? null),
      })),
    })),
  } as unknown as Env['DB'];
}

describe('artifact roles', () => {
  it('returns owner when user owns the artifact', async () => {
    const env = { DB: makeDbMock({
      first: (sql) => {
        if (sql.includes('owner_id')) return { owner_id: 'usr_1' };
        return null;
      },
    }) } as Env;

    await expect(getUserRole(env, 'art_1', 'usr_1')).resolves.toBe('owner');
  });

  it('returns collaborator role when user is invited', async () => {
    const env = { DB: makeDbMock({
      first: (sql) => {
        if (sql.includes('owner_id')) return { owner_id: 'usr_other' };
        if (sql.includes('FROM users')) return { email: 'editor@example.com' };
        if (sql.includes('collaborators')) return { role: 'editor' };
        return null;
      },
    }) } as Env;

    await expect(getUserRole(env, 'art_1', 'usr_2')).resolves.toBe('editor');
  });

  it('returns null when user has no access', async () => {
    const env = { DB: makeDbMock({
      first: (sql) => {
        if (sql.includes('owner_id')) return { owner_id: 'usr_other' };
        if (sql.includes('FROM users')) return { email: 'stranger@example.com' };
        return null;
      },
    }) } as Env;

    await expect(getUserRole(env, 'art_1', 'usr_3')).resolves.toBeNull();
  });

  it('requireRole returns 403 when role is insufficient', async () => {
    const env = { DB: makeDbMock({
      first: (sql) => {
        if (sql.includes('owner_id')) return { owner_id: 'usr_other' };
        if (sql.includes('FROM users')) return { email: 'viewer@example.com' };
        if (sql.includes('collaborators')) return { role: 'viewer' };
        return null;
      },
    }) } as Env;

    const denied = await requireRole(env, 'art_1', 'usr_2', 'editor');
    expect(denied).not.toBeNull();
    expect(denied!.status).toBe(403);
  });

  it('requireRole returns null when access is granted', async () => {
    const env = { DB: makeDbMock({
      first: (sql) => {
        if (sql.includes('owner_id')) return { owner_id: 'usr_1' };
        return null;
      },
    }) } as Env;

    await expect(requireRole(env, 'art_1', 'usr_1', 'editor')).resolves.toBeNull();
  });
});
