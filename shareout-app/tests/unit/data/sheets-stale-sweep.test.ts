// @vitest-environment node
import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import type { Env } from '../../../src/types';
import { runStaleDataSweep } from '../../../src/data/sheets/stale-sweep';

const e = env as unknown as Env;

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
}

beforeAll(async () => {
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, deleted_at TEXT)`);
  await e.DB.exec(
    `CREATE TABLE IF NOT EXISTS sheet_syncs (id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL, name TEXT NOT NULL, last_synced_at TEXT, last_notified_stale_at TEXT)`,
  );
  await e.DB.exec(
    `CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, recipient_type TEXT NOT NULL, recipient_id TEXT NOT NULL, kind TEXT NOT NULL, subject_type TEXT, subject_id TEXT, message TEXT, payload TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
  );
});

beforeEach(async () => {
  await e.DB.exec('DELETE FROM artifacts');
  await e.DB.exec('DELETE FROM sheet_syncs');
  await e.DB.exec('DELETE FROM notifications');
});

async function eventCount(artifactId: string): Promise<number> {
  const row = await e.DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind = 'stale_data' AND recipient_id = ?")
    .bind(artifactId).first<{ n: number }>();
  return row?.n ?? 0;
}

describe('runStaleDataSweep', () => {
  it('flags a connection stale past the threshold and skips a fresh one', async () => {
    await e.DB.exec(`INSERT INTO artifacts (id) VALUES ('art_stale'), ('art_fresh')`);
    await e.DB.prepare(
      `INSERT INTO sheet_syncs (id, artifact_id, name, last_synced_at) VALUES (?, ?, ?, ?)`,
    ).bind('conn_stale', 'art_stale', 'Revenue sheet', daysAgo(10)).run();
    await e.DB.prepare(
      `INSERT INTO sheet_syncs (id, artifact_id, name, last_synced_at) VALUES (?, ?, ?, ?)`,
    ).bind('conn_fresh', 'art_fresh', 'Costs sheet', daysAgo(2)).run();

    const result = await runStaleDataSweep(e);

    expect(result.notified).toBe(1);
    expect(await eventCount('art_stale')).toBe(1);
    expect(await eventCount('art_fresh')).toBe(0);
  });

  it('does not re-notify while still within the cooldown', async () => {
    await e.DB.exec(`INSERT INTO artifacts (id) VALUES ('art_stale')`);
    await e.DB.prepare(
      `INSERT INTO sheet_syncs (id, artifact_id, name, last_synced_at) VALUES (?, ?, ?, ?)`,
    ).bind('conn_stale', 'art_stale', 'Revenue sheet', daysAgo(10)).run();

    await runStaleDataSweep(e); // first sweep notifies + stamps cooldown
    const second = await runStaleDataSweep(e); // still stale, but within cooldown

    expect(second.notified).toBe(0);
    expect(await eventCount('art_stale')).toBe(1);
  });

  it('re-notifies once the cooldown has elapsed while still stale', async () => {
    await e.DB.exec(`INSERT INTO artifacts (id) VALUES ('art_stale')`);
    await e.DB.prepare(
      `INSERT INTO sheet_syncs (id, artifact_id, name, last_synced_at, last_notified_stale_at) VALUES (?, ?, ?, ?, ?)`,
    ).bind('conn_stale', 'art_stale', 'Revenue sheet', daysAgo(20), daysAgo(8)).run();

    const result = await runStaleDataSweep(e);

    expect(result.notified).toBe(1);
    expect(await eventCount('art_stale')).toBe(1);
  });

  it('skips artifacts with no provenance feed (no Sheets connection) and soft-deleted artifacts', async () => {
    await e.DB.exec(`INSERT INTO artifacts (id) VALUES ('art_no_feed')`);
    await e.DB.exec(`INSERT INTO artifacts (id, deleted_at) VALUES ('art_deleted', '2020-01-01')`);
    await e.DB.prepare(
      `INSERT INTO sheet_syncs (id, artifact_id, name, last_synced_at) VALUES (?, ?, ?, ?)`,
    ).bind('conn_deleted', 'art_deleted', 'Old sheet', daysAgo(30)).run();

    const result = await runStaleDataSweep(e);

    expect(result.notified).toBe(0);
    expect(await eventCount('art_no_feed')).toBe(0);
    expect(await eventCount('art_deleted')).toBe(0);
  });
});
