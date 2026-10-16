// fetchHistories against real D1 (Miniflare): the 30-day window and per-rule cap
// must hold in SQL. evaluated_at is ISO TEXT; an epoch-number cutoff compares as
// text and matched every row, so the Automate tab read each rule's whole run ledger.
import { env } from 'cloudflare:workers';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fetchHistories } from '../../../src/metric-alerts/rules';
import type { Env } from '../../../src/types';

const e = env as unknown as Env;

beforeAll(async () => {
  await e.DB.exec(
    'CREATE TABLE IF NOT EXISTS metric_alert_runs (id TEXT PRIMARY KEY, rule_id TEXT NOT NULL, artifact_id TEXT NOT NULL, metric_id TEXT NOT NULL, evaluated_at TEXT NOT NULL, value REAL)',
  );
});

beforeEach(async () => {
  await e.DB.exec('DELETE FROM metric_alert_runs');
});

async function run(id: string, rule: string, at: Date, value: number | null) {
  await e.DB.prepare('INSERT INTO metric_alert_runs (id, rule_id, artifact_id, metric_id, evaluated_at, value) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, rule, 'art_1', 'm', at.toISOString(), value).run();
}

const daysAgo = (d: number, minutes = 0) => new Date(Date.now() - d * 86400_000 - minutes * 60_000);

describe('fetchHistories (D1)', () => {
  it('drops runs older than 30 days', async () => {
    await run('old', 'r1', daysAgo(400), 99);
    await run('new', 'r1', daysAgo(1), 5);
    expect(await fetchHistories(e, ['r1'])).toEqual({ r1: [5] });
  });

  it('caps each rule at `limit` newest values, oldest→newest, in SQL', async () => {
    for (let i = 0; i < 6; i++) await run(`a${i}`, 'r1', daysAgo(0, 60 - i), i);
    await run('b0', 'r2', daysAgo(0, 5), 42);
    await run('n0', 'r2', daysAgo(0, 4), null);
    const h = await fetchHistories(e, ['r1', 'r2'], 3);
    expect(h).toEqual({ r1: [3, 4, 5], r2: [42] });
  });
});
