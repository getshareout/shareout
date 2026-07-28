// The one table now counts every rate limit in the product, and each caller writes a
// window key of its own shape — an ISO day (publish), an ISO hour (present), a bare
// date (scheduling), `YYYY-MM-DDTHH:MM` (agent minute). The nightly prune has to
// understand all four with one string cutoff, and the four principals must not collide.
import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import { cleanupOldRateLimits } from '../../src/api-auth';
import type { Env } from '../../src/types';

const e = env as unknown as Env;

beforeAll(async () => {
  await e.DB.exec(
    `CREATE TABLE IF NOT EXISTS rate_limits (principal_type TEXT NOT NULL, principal_id TEXT NOT NULL, action TEXT NOT NULL, window_start TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (principal_type, principal_id, action, window_start))`,
  );
});

beforeEach(async () => {
  await e.DB.exec('DELETE FROM rate_limits');
});

async function seed(rows: Array<[string, string, string, string]>) {
  for (const [ptype, pid, action, window] of rows) {
    await e.DB.prepare(
      'INSERT INTO rate_limits (principal_type, principal_id, action, window_start, count) VALUES (?, ?, ?, ?, 1)',
    ).bind(ptype, pid, action, window).run();
  }
}

async function remaining(): Promise<string[]> {
  const { results } = await e.DB.prepare(
    'SELECT window_start FROM rate_limits ORDER BY window_start',
  ).all<{ window_start: string }>();
  return (results ?? []).map(r => r.window_start);
}

describe('cleanupOldRateLimits', () => {
  it('prunes every window format older than the cutoff and keeps the current ones', async () => {
    const now = Date.now();
    const day = (offset: number) => new Date(now + offset * 86400_000).toISOString().slice(0, 10);

    await seed([
      ['user', 'usr_1', 'publish', `${day(-10)}T00:00:00.000Z`],       // stale ISO day
      ['user', 'usr_1', 'present', `${day(-10)}T13:00:00.000Z`],       // stale ISO hour
      ['user', 'usr_1', 'schedule:email', day(-10)],                    // stale bare date
      ['artifact', 'art_1', 'agent_requests', `${day(-10)}T13:37`],     // stale minute
      ['user', 'usr_1', 'publish', `${day(0)}T00:00:00.000Z`],          // today
      ['artifact', 'art_1', 'agent_requests', `${day(0)}T13:37`],       // this minute
    ]);

    const pruned = await cleanupOldRateLimits(e);

    expect(pruned).toBe(4);
    expect(await remaining()).toEqual([`${day(0)}T00:00:00.000Z`, `${day(0)}T13:37`]);
  });

  it('keeps yesterday, because a UTC-day window is still being counted', async () => {
    const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
    await seed([['user', 'usr_1', 'publish', `${yesterday}T00:00:00.000Z`]]);

    expect(await cleanupOldRateLimits(e)).toBe(0);
    expect(await remaining()).toHaveLength(1);
  });

  it('counts the same action separately per principal', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await seed([
      ['user', 'usr_1', 'agent_requests', `${today}T13:37`],
      ['artifact', 'art_1', 'agent_requests', `${today}T13:37`],
    ]);

    expect(await remaining()).toHaveLength(2);
  });
});
