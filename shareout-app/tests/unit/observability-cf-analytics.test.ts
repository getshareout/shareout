// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../src/types';
import { countExceededMemoryKills } from '../../src/observability/cf-worker-analytics';

describe('countExceededMemoryKills', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns null without CF credentials', async () => {
    const n = await countExceededMemoryKills({} as Env, new Date('2026-07-10T15:00:00.000Z'));
    expect(n).toBeNull();
  });

  it('sums exceededMemory rows from GraphQL', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: {
            viewer: {
              accounts: [
                {
                  workersInvocationsAdaptive: [
                    { sum: { requests: 1000 }, dimensions: { status: 'success' } },
                    { sum: { requests: 2 }, dimensions: { status: 'exceededMemory' } },
                    { sum: { requests: 1 }, dimensions: { status: 'exceededMemory' } },
                  ],
                },
              ],
            },
          },
        }),
      }))
    );

    const env = { CF_API_TOKEN: 'tok', CF_ACCOUNT_ID: 'acct' } as Env;
    const n = await countExceededMemoryKills(env, new Date('2026-07-10T15:00:00.000Z'));
    expect(n).toBe(3);
  });
});
