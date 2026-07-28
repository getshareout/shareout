import { describe, expect, it, vi } from 'vitest';
import { getDailyHealth } from '../../../src/observability/store';
import type { Env } from '../../../src/types';

function makeEnv(rows: Array<{ day: string; requests: number; s5: number; exc: number }>): Env {
  return {
    DB: {
      prepare: vi.fn(() => ({
        bind: vi.fn(() => ({
          all: vi.fn(async () => ({ results: rows })),
        })),
      })),
    },
  } as unknown as Env;
}

describe('getDailyHealth', () => {
  it('maps rows to uptime percentage', async () => {
    const days = await getDailyHealth(
      makeEnv([
        { day: '2026-07-01', requests: 1000, s5: 5, exc: 5 },
        { day: '2026-07-02', requests: 0, s5: 0, exc: 0 },
      ]),
      90,
    );
    expect(days).toHaveLength(2);
    expect(days[0].uptimePct).toBeCloseTo(99, 5); // 990/1000
    expect(days[1].uptimePct).toBe(100); // no traffic = not down
  });
});
