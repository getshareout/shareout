// Pending AI calls (not yet priced by the hourly reconcile) count at list price wherever spend is shown.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/data/agent/model-costs', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  priceCall: vi.fn(async (_env: unknown, model: string, tin: number, tout: number) => ({ microUsd: model === 'm-free' ? 0 : tin * 2 + tout * 10, priced: true })),
}));

import { pendingAiCost } from '../../src/data/ai-pending';
import type { Env } from '../../src/types';

function env(rows: Array<{ k: string | null; model: string; tin: number | null; tout: number | null }>) {
  const seen: { sql: string; args: unknown[] }[] = [];
  const DB = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: unknown[]) => { seen.push({ sql, args }); return { all: vi.fn(async () => ({ results: rows })) }; }),
    })),
  };
  return { env: { DB } as unknown as Env, seen };
}

describe('pendingAiCost', () => {
  it('prices pending rows per user across models, only for this workspace and window', async () => {
    const { env: e, seen } = env([
      { k: 'usr_a', model: 'm1', tin: 100, tout: 10 },
      { k: 'usr_a', model: 'm2', tin: 50, tout: null },
      { k: null, model: 'm1', tin: 1, tout: 1 },
    ]);
    const out = await pendingAiCost(e, 'wsp_1', '2026-11-01', '2026-12-01', 'user_id');
    expect(out.get('usr_a')).toBe(100 * 2 + 10 * 10 + 50 * 2);
    expect(out.get(null)).toBe(12);
    expect(seen[0]!.args).toEqual(['wsp_1', '2026-11-01', '2026-12-01']);
    expect(seen[0]!.sql).toContain("cost_source = 'pending'");
    expect(seen[0]!.sql).toContain('user_id AS k');
  });

  it('groups by UTC day when asked', async () => {
    const { env: e, seen } = env([{ k: '2026-11-04', model: 'm1', tin: 10, tout: 0 }]);
    expect((await pendingAiCost(e, 'wsp_1', '2026-11-01', '2026-12-01', 'day')).get('2026-11-04')).toBe(20);
    expect(seen[0]!.sql).toContain('substr(created_at, 1, 10) AS k');
  });
});
