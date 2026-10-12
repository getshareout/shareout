import { describe, expect, it } from 'vitest';
import { handleHomeActivityFeedApi, handleHomeAnalyticsApi, handleHomeForYouApi, handleHomeRecentApi } from '../../../src/pages/home/api';
import type { Env } from '../../../src/types';

const user = { id: 'usr_1', email: 'owner@example.com' };

function mkEnv(memberOf: string[]): Env {
  const DB = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => (sql.includes('FROM workspace_members WHERE workspace_id = ?') && memberOf.includes(args[0] as string) ? { 1: 1 } : null),
        all: async () => ({ results: [] }),
        run: async () => ({ success: true }),
      }),
    }),
    batch: async (stmts: unknown[]) => stmts.map(() => ({ results: [] })),
  };
  return { DB } as unknown as Env;
}

const req = (path: string) => new Request(`https://shareout.site${path}`, { headers: { host: 'shareout.site' } });

describe('home APIs never serve a workspace the user is not a member of', () => {
  const cases = [
    ['for-you', handleHomeForYouApi, '/v1/home/for-you?workspace='],
    ['recent', handleHomeRecentApi, '/v1/home/recent?workspace='],
    ['activity-feed', handleHomeActivityFeedApi, '/v1/home/activity-feed?workspace='],
    ['analytics', handleHomeAnalyticsApi, '/v1/home/analytics?workspace='],
  ] as const;

  for (const [name, handler, path] of cases) {
    it(`${name}: 403 for a non-member workspace`, async () => {
      const res = await handler(req(path + 'wsp_other'), mkEnv(['wsp_mine']), user);
      expect(res.status).toBe(403);
    });

    it(`${name}: 200 for a member workspace`, async () => {
      const res = await handler(req(path + 'wsp_mine'), mkEnv(['wsp_mine']), user);
      expect(res.status).toBe(200);
    });
  }
});
