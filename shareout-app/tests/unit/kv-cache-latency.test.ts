import { describe, expect, it } from 'vitest';
import type { Env } from '../../src/types';
import { isFeatureEnabled } from '../../src/features/flags';
import { getInternalWorkspaceRole } from '../../src/workspaces/roles';
import { validateToken } from '../../src/api-auth';

const never = () => new Promise<never>(() => {});

// A SLUGS cache whose reads and writes never settle (prod saw a 10 s miss and ~0.5 s writes).
function stalledEnv(rows: (sql: string) => unknown): Env {
  return {
    SLUGS: { get: never, put: never, delete: never },
    DB: {
      prepare: (sql: string) => ({
        bind: () => ({ first: async () => rows(sql), run: never }),
      }),
    },
  } as unknown as Env;
}

describe('request path does not wait on the SLUGS cache', () => {
  it('resolves feature flags from D1 when the cache is stalled', async () => {
    const env = stalledEnv((sql) => (sql.includes('FROM workspaces') ? { feature_flags: '{"ai.crew":false}' } : null));
    expect(await isFeatureEnabled(env, 'ai.crew', 'ws1')).toBe(false);
  });

  it('resolves the workspace role from D1 when the cache is stalled', async () => {
    const env = stalledEnv((sql) => (sql.includes('workspace_members') ? { role: 'member' } : null));
    expect(await getInternalWorkspaceRole(env, 'ws1', 'usr_1')).toBe('member');
  });

  it('authenticates a token without waiting on the last-used write', async () => {
    const env = stalledEnv((sql) => (sql.includes('FROM tokens') ? { user_id: 'usr_1', email: 'a@x.com', username: null } : null));
    const req = new Request('https://example.com/v1/me', { headers: { Authorization: 'Bearer so_abc' } });
    expect(await validateToken(req, env)).toMatchObject({ id: 'usr_1' });
  });
});
