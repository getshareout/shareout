// @vitest-environment node
import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import type { Env } from '../../../src/types';

// Mock artifact access (permission) and the MiniDB metric reader so the sweep and
// CRUD can be tested without a real artifact store or Durable Object.
const resolveAlertRole = vi.hoisted(() => vi.fn());
const getArtifactRef = vi.hoisted(() => vi.fn());
const evaluateMetric = vi.hoisted(() => vi.fn());

vi.mock('../../../src/metric-alerts/access', () => ({ resolveAlertRole, getArtifactRef }));
vi.mock('../../../src/metric-alerts/sources', async (importActual) => {
  const actual = await importActual<typeof import('../../../src/metric-alerts/sources')>();
  return { ...actual, evaluateMetric };
});

import { createWatch, runMetricWatchSweep } from '../../../src/metric-watch/watches';

const e = env as unknown as Env;

beforeAll(async () => {
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, name TEXT, deleted_at TEXT)`);
  await e.DB.exec(
    `CREATE TABLE IF NOT EXISTS metric_watches (id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL, workspace_id TEXT, created_by TEXT NOT NULL, table_name TEXT NOT NULL, metric_kind TEXT NOT NULL, column_name TEXT NOT NULL DEFAULT '', threshold_pct REAL NOT NULL DEFAULT 20, last_value REAL, last_checked_at TEXT, last_alerted_at TEXT, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), UNIQUE(artifact_id, table_name, metric_kind, column_name))`
  );
  await e.DB.exec(
    `CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, recipient_type TEXT NOT NULL, recipient_id TEXT NOT NULL, kind TEXT NOT NULL, subject_type TEXT, subject_id TEXT, message TEXT, payload TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`
  );
});

beforeEach(async () => {
  await e.DB.exec('DELETE FROM artifacts');
  await e.DB.exec('DELETE FROM metric_watches');
  await e.DB.exec('DELETE FROM notifications');
  vi.clearAllMocks();
  resolveAlertRole.mockResolvedValue('manager');
  getArtifactRef.mockImplementation(async (_env: Env, id: string) => ({ id, workspace_id: null }));
});

/** ISO instant `deltaSec` from now — the TEXT format the schema stores. */
const iso = (deltaSec = 0) => new Date(Date.now() + deltaSec * 1000).toISOString();

async function seedWatch(over: Record<string, unknown> = {}): Promise<string> {
  const w = {
    id: 'mw_1', artifact_id: 'art_1', workspace_id: null, created_by: 'user_1',
    table_name: 'orders', metric_kind: 'count', column_name: '', threshold_pct: 20,
    last_value: null, last_alerted_at: null, enabled: 1, ...over,
  } as Record<string, unknown>;
  await e.DB.prepare(`INSERT OR IGNORE INTO artifacts (id, name) VALUES (?, ?)`).bind(w.artifact_id, 'Dash').run();
  await e.DB.prepare(
    `INSERT INTO metric_watches (id, artifact_id, workspace_id, created_by, table_name, metric_kind, column_name, threshold_pct, last_value, last_alerted_at, enabled)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(w.id, w.artifact_id, w.workspace_id, w.created_by, w.table_name, w.metric_kind, w.column_name, w.threshold_pct, w.last_value, w.last_alerted_at, w.enabled).run();
  return w.id as string;
}

async function eventCount(artifactId: string): Promise<number> {
  const r = await e.DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'metric_watch' AND recipient_id = ?").bind(artifactId).first<{ n: number }>();
  return r?.n ?? 0;
}
async function lastValue(id: string): Promise<number | null> {
  const r = await e.DB.prepare('SELECT last_value AS v FROM metric_watches WHERE id = ?').bind(id).first<{ v: number | null }>();
  return r?.v ?? null;
}

describe('createWatch (auth)', () => {
  it('rejects a user with no access to the artifact', async () => {
    resolveAlertRole.mockResolvedValue(null); // non-member
    const res = await createWatch(e, 'stranger', 'art_1', { table: 'orders', kind: 'count' });
    expect(res.error).toMatch(/permission denied/i);
    expect(res.watch).toBeUndefined();
  });

  it('creates a watch for a member and is idempotent on the same metric', async () => {
    await e.DB.prepare(`INSERT INTO artifacts (id, name) VALUES ('art_1', 'Dash')`).run();
    const first = await createWatch(e, 'user_1', 'art_1', { table: 'orders', kind: 'count' });
    expect(first.watch?.metric_kind).toBe('count');
    const second = await createWatch(e, 'user_1', 'art_1', { table: 'orders', kind: 'count' });
    expect(second.watch?.id).toBe(first.watch?.id); // no duplicate
    const n = await e.DB.prepare('SELECT COUNT(*) AS n FROM metric_watches').first<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it('validates the metric spec', async () => {
    await e.DB.prepare(`INSERT INTO artifacts (id, name) VALUES ('art_1', 'Dash')`).run();
    const res = await createWatch(e, 'user_1', 'art_1', { table: 'orders', kind: 'sum' }); // missing column
    expect(res.error).toMatch(/column is required/i);
  });
});

describe('runMetricWatchSweep', () => {
  it('sets the baseline on first check without alerting', async () => {
    const id = await seedWatch({ last_value: null });
    evaluateMetric.mockResolvedValue({ value: 100 });
    const res = await runMetricWatchSweep(e);
    expect(res.alerted).toBe(0);
    expect(await eventCount('art_1')).toBe(0);
    expect(await lastValue(id)).toBe(100);
  });

  it('alerts and advances the baseline on a move past the threshold', async () => {
    const id = await seedWatch({ last_value: 100 });
    evaluateMetric.mockResolvedValue({ value: 140 }); // +40%
    const res = await runMetricWatchSweep(e);
    expect(res.alerted).toBe(1);
    expect(await eventCount('art_1')).toBe(1);
    expect(await lastValue(id)).toBe(140);
  });

  it('does not alert within the 6h cooldown but still advances the baseline', async () => {
    const id = await seedWatch({ last_value: 100, last_alerted_at: iso(-60) }); // alerted a minute ago
    evaluateMetric.mockResolvedValue({ value: 140 });
    const res = await runMetricWatchSweep(e);
    expect(res.alerted).toBe(0);
    expect(await eventCount('art_1')).toBe(0);
    expect(await lastValue(id)).toBe(140); // baseline drift continues
  });

  it('isolates a failing watch from the rest of the sweep', async () => {
    await seedWatch({ id: 'mw_bad', artifact_id: 'art_bad', last_value: 100 });
    await seedWatch({ id: 'mw_good', artifact_id: 'art_good', last_value: 100 });
    evaluateMetric.mockImplementation(async (_env: Env, artifactId: string) => {
      if (artifactId === 'art_bad') throw new Error('minidb down');
      return { value: 140 };
    });
    const res = await runMetricWatchSweep(e);
    expect(res.alerted).toBe(1);
    expect(await eventCount('art_good')).toBe(1);
    expect(await eventCount('art_bad')).toBe(0);
  });
});
