// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { runBandwidthAutoPause } from '../../../src/moderation/maintenance';
import type { Env } from '../../../src/types';

vi.mock('../../../src/observability/alerts', () => ({ notifyAdmin: vi.fn(async () => {}) }));

interface Owner { owner_id: string; est_bytes: number }

/** Records every statement so the test can assert whether a pause was issued. */
function makeEnv(owners: Owner[], vars: Record<string, string> = {}) {
  const run: string[] = [];
  const env = {
    ...vars,
    DB: {
      prepare: (sql: string) => ({
        bind: () => ({
          first: async () => (sql.includes("date('now'") ? { d: '2026-07-24' } : null),
          all: async () => ({ results: owners }),
          run: async () => {
            run.push(sql.replace(/\s+/g, ' ').trim());
            return { success: true };
          },
        }),
        first: async () => (sql.includes("date('now'") ? { d: '2026-07-24' } : null),
        all: async () => ({ results: owners }),
      }),
    },
  } as unknown as Env;
  return { env, run };
}

const OVER = [{ owner_id: 'usr_1', est_bytes: 10_000_000_000 }];

describe('runBandwidthAutoPause', () => {
  // This used to read the owner's plan tier and apply the free-tier 5 GB/day cap.
  // Every account on a self-hosted instance reads as free, so a busy public page
  // got its owner's whole public surface auto-paused — on infrastructure the
  // operator pays for themselves.
  it('does nothing when no cap is configured', async () => {
    const { env, run } = makeEnv(OVER);
    expect(await runBandwidthAutoPause(env)).toEqual({ checked: 0, paused: 0 });
    expect(run).toHaveLength(0);
  });

  it('does nothing when the cap is zero or unparseable', async () => {
    for (const value of ['0', '', 'lots']) {
      const { env, run } = makeEnv(OVER, { DAILY_BANDWIDTH_BYTES_PER_OWNER: value });
      expect(await runBandwidthAutoPause(env)).toEqual({ checked: 0, paused: 0 });
      expect(run).toHaveLength(0);
    }
  });

  it('pauses an owner over the configured cap', async () => {
    const { env, run } = makeEnv(OVER, { DAILY_BANDWIDTH_BYTES_PER_OWNER: '5000000000' });
    expect(await runBandwidthAutoPause(env)).toEqual({ checked: 1, paused: 1 });
    expect(run[0]).toContain('UPDATE artifacts SET paused = 1');
  });

  it('leaves an owner under the cap alone', async () => {
    const { env, run } = makeEnv([{ owner_id: 'usr_1', est_bytes: 1_000_000 }], {
      DAILY_BANDWIDTH_BYTES_PER_OWNER: '5000000000',
    });
    expect(await runBandwidthAutoPause(env)).toEqual({ checked: 1, paused: 0 });
    expect(run).toHaveLength(0);
  });
});
