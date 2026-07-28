// @vitest-environment node
import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import type { Env } from '../../src/types';
import { runUnusedArtifactSweep, findUnusedArtifacts } from '../../src/artifacts/unused-sweep';

const e = env as unknown as Env;

// The schema's TEXT timestamp format, so string comparisons order correctly.
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}
function dateDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}
function unixDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

beforeAll(async () => {
  await e.DB.exec(
    `CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT, last_janitor_at INTEGER)`,
  );
  await e.DB.exec(
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, name TEXT, disabled INTEGER DEFAULT 0, last_janitor_at INTEGER)`,
  );
  await e.DB.exec(
    `CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, workspace_id TEXT, owner_id TEXT, deleted_at TEXT, is_example INTEGER DEFAULT 0, created_at TEXT, name TEXT, slug TEXT)`,
  );
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS deployments (artifact_id TEXT, channel TEXT, updated_at TEXT)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS analytics_daily (artifact_id TEXT, date TEXT, views INTEGER)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS analytics_events (artifact_id TEXT, event_type TEXT, created_at TEXT)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS user_recent_views (user_id TEXT, artifact_id TEXT, viewed_at TEXT)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS favorites (user_id TEXT, artifact_id TEXT)`);
  await e.DB.exec(
    `CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, recipient_type TEXT NOT NULL, recipient_id TEXT NOT NULL, kind TEXT NOT NULL, subject_type TEXT, subject_id TEXT, message TEXT, payload TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
  );
});

beforeEach(async () => {
  for (const t of ['workspaces', 'users', 'artifacts', 'deployments', 'analytics_daily', 'analytics_events', 'user_recent_views', 'favorites', 'notifications']) {
    await e.DB.exec(`DELETE FROM ${t}`);
  }
});

async function addWorkspace(id: string, lastJanitor: number | null = null): Promise<void> {
  await e.DB.prepare(`INSERT INTO workspaces (id, name, last_janitor_at) VALUES (?, ?, ?)`)
    .bind(id, id, lastJanitor).run();
}

async function addUser(id: string, opts: Partial<{ lastJanitor: number | null; disabled: number }> = {}): Promise<void> {
  await e.DB.prepare(`INSERT INTO users (id, email, name, disabled, last_janitor_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, `${id}@e.test`, id, opts.disabled ?? 0, opts.lastJanitor ?? null).run();
}

/** A published (production-deployed), old, never-viewed artifact — the janitor target.
 *  Personal fixtures pass workspaceId=null + ownerId. */
async function addUnused(id: string, workspaceId: string | null, opts: Partial<{ createdAgo: number; isExample: number; deleted: string | null; published: boolean; updatedAgo: number; ownerId: string }> = {}): Promise<void> {
  const createdAgo = opts.createdAgo ?? 120;
  await e.DB.prepare(
    `INSERT INTO artifacts (id, workspace_id, owner_id, deleted_at, is_example, created_at, name, slug) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, workspaceId, opts.ownerId ?? null, opts.deleted ?? null, opts.isExample ?? 0, daysAgo(createdAgo), id, id).run();
  if (opts.published !== false) {
    await e.DB.prepare(`INSERT INTO deployments (artifact_id, channel, updated_at) VALUES (?, 'production', ?)`).bind(id, daysAgo(opts.updatedAgo ?? createdAgo)).run();
  }
}

async function eventFor(workspaceId: string): Promise<{ artifact_count: number; sample_titles: string } | null> {
  return e.DB.prepare(
    `SELECT json_extract(payload, '$.artifact_count') AS artifact_count,
            json_extract(payload, '$.sample_titles') AS sample_titles
       FROM notifications WHERE kind = 'unused_artifacts' AND recipient_type = 'workspace' AND recipient_id = ?`
  ).bind(workspaceId).first<{ artifact_count: number; sample_titles: string }>();
}
async function eventForUser(userId: string): Promise<{ artifact_count: number; sample_titles: string } | null> {
  return e.DB.prepare(
    `SELECT json_extract(payload, '$.artifact_count') AS artifact_count,
            json_extract(payload, '$.sample_titles') AS sample_titles
       FROM notifications WHERE kind = 'unused_artifacts' AND recipient_type = 'user' AND recipient_id = ?`
  ).bind(userId).first<{ artifact_count: number; sample_titles: string }>();
}
async function lastJanitor(workspaceId: string): Promise<number | null> {
  const r = await e.DB.prepare('SELECT last_janitor_at FROM workspaces WHERE id = ?').bind(workspaceId).first<{ last_janitor_at: number | null }>();
  return r?.last_janitor_at ?? null;
}
async function userLastJanitor(userId: string): Promise<number | null> {
  const r = await e.DB.prepare('SELECT last_janitor_at FROM users WHERE id = ?').bind(userId).first<{ last_janitor_at: number | null }>();
  return r?.last_janitor_at ?? null;
}

describe('findUnusedArtifacts', () => {
  it('includes only published, old, zero-view, non-example, non-deleted artifacts', async () => {
    await addWorkspace('ws');
    await addUnused('a_old_unused', 'ws');                              // ✓ target
    await addUnused('a_young', 'ws', { createdAgo: 10 });               // ✗ within 90-day grace
    await addUnused('a_example', 'ws', { isExample: 1 });               // ✗ example
    await addUnused('a_deleted', 'ws', { deleted: daysAgo(1) });        // ✗ soft-deleted
    await addUnused('a_draft', 'ws', { published: false });             // ✗ no production deployment

    // ✗ viewed recently (rolled-up analytics_daily row inside the window)
    await addUnused('a_viewed_daily', 'ws');
    await e.DB.prepare(`INSERT INTO analytics_daily (artifact_id, date, views) VALUES (?, ?, 5)`).bind('a_viewed_daily', dateDaysAgo(3)).run();

    // ✗ viewed today (un-rolled-up analytics_events inside the window)
    await addUnused('a_viewed_event', 'ws');
    await e.DB.prepare(`INSERT INTO analytics_events (artifact_id, event_type, created_at) VALUES (?, 'view', ?)`).bind('a_viewed_event', unixDaysAgo(1)).run();

    // ✓ only a stale view (>90 days ago) — still counts as unused
    await addUnused('a_old_view', 'ws');
    await e.DB.prepare(`INSERT INTO analytics_daily (artifact_id, date, views) VALUES (?, ?, 9)`).bind('a_old_view', dateDaysAgo(120)).run();

    // ✗ created 120 days ago but re-published recently (deployments.updated_at guard)
    await addUnused('a_republished', 'ws', { updatedAgo: 5 });

    // ✗ created 120 days ago but opened in-app recently (user_recent_views guard)
    await addUnused('a_recent_open', 'ws');
    await e.DB.prepare(`INSERT INTO user_recent_views (user_id, artifact_id, viewed_at) VALUES ('u1', 'a_recent_open', ?)`).bind(unixDaysAgo(3)).run();

    // ✗ old, unviewed, but starred by someone — starring is an explicit keep-marker
    await addUnused('a_starred', 'ws');
    await e.DB.prepare(`INSERT INTO favorites (user_id, artifact_id) VALUES ('anyone', 'a_starred')`).run();

    const ids = (await findUnusedArtifacts(e, { workspaceId: 'ws' })).map((u) => u.id).sort();
    expect(ids).toEqual(['a_old_unused', 'a_old_view']);
  });

  it('personal scope sees only that user\'s personal (workspace_id NULL) artifacts', async () => {
    await addUnused('mine', null, { ownerId: 'u1' });          // ✓ target
    await addUnused('theirs', null, { ownerId: 'u2' });        // ✗ another user's personal
    await addUnused('in_ws', 'ws', { ownerId: 'u1' });         // ✗ same owner, but in a workspace

    const ids = (await findUnusedArtifacts(e, { ownerUserId: 'u1' })).map((u) => u.id).sort();
    expect(ids).toEqual(['mine']);
  });
});

describe('runUnusedArtifactSweep', () => {
  it('emits one event (count + titles) when 3+ pages are unused, and stamps the cooldown', async () => {
    await addWorkspace('ws');
    await addUnused('u1', 'ws');
    await addUnused('u2', 'ws');
    await addUnused('u3', 'ws');

    const result = await runUnusedArtifactSweep(e);

    expect(result.notified).toBe(1);
    const ev = await eventFor('ws');
    expect(ev?.artifact_count).toBe(3);
    expect(JSON.parse(ev!.sample_titles)).toEqual(['u1', 'u2', 'u3']);
    expect(await lastJanitor('ws')).not.toBeNull();
  });

  it('does not nag below the threshold but still stamps the cooldown', async () => {
    await addWorkspace('ws');
    await addUnused('u1', 'ws');
    await addUnused('u2', 'ws'); // only 2 — below MIN_UNUSED

    const result = await runUnusedArtifactSweep(e);

    expect(result.notified).toBe(0);
    expect(await eventFor('ws')).toBeNull();
    expect(await lastJanitor('ws')).not.toBeNull(); // sub-threshold still gates monthly
  });

  it('does not re-emit within the 30-day cooldown', async () => {
    await addWorkspace('ws');
    await addUnused('u1', 'ws');
    await addUnused('u2', 'ws');
    await addUnused('u3', 'ws');

    await runUnusedArtifactSweep(e); // notifies + stamps
    const second = await runUnusedArtifactSweep(e); // within cooldown — workspace not re-selected

    expect(second.notified).toBe(0);
    const n = await e.DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE recipient_type = 'workspace' AND recipient_id = ?").bind('ws').first<{ n: number }>();
    expect(n?.n).toBe(1);
  });

  it('re-selects a workspace once the cooldown has elapsed', async () => {
    await addWorkspace('ws', unixDaysAgo(40)); // last swept 40 days ago
    await addUnused('u1', 'ws');
    await addUnused('u2', 'ws');
    await addUnused('u3', 'ws');

    const result = await runUnusedArtifactSweep(e);
    expect(result.notified).toBe(1);
  });

  it('processes multiple workspaces and isolates a per-workspace failure', async () => {
    await addWorkspace('ws_a');
    await addWorkspace('ws_b');
    for (const w of ['ws_a', 'ws_b']) { await addUnused(w + '_1', w); await addUnused(w + '_2', w); await addUnused(w + '_3', w); }

    const result = await runUnusedArtifactSweep(e);
    expect(result.notified).toBe(2);
    expect(await lastJanitor('ws_a')).not.toBeNull();
    expect(await lastJanitor('ws_b')).not.toBeNull();
  });

  it('never throws out of the scheduled handler even if a write fails', async () => {
    await addWorkspace('ws');
    await addUnused('u1', 'ws');
    await addUnused('u2', 'ws');
    await addUnused('u3', 'ws');
    await e.DB.exec('DROP TABLE notifications'); // event insert will throw per-workspace

    const result = await runUnusedArtifactSweep(e);
    expect(result.notified).toBe(0); // swallowed by the per-workspace try/catch

    // restore for other tests' beforeEach
    await e.DB.exec(
      `CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, recipient_type TEXT NOT NULL, recipient_id TEXT NOT NULL, kind TEXT NOT NULL, subject_type TEXT, subject_id TEXT, message TEXT, payload TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
    );
  });

  it('personal: emits an event with owner_user_id and stamps the user cooldown at 3+ unused', async () => {
    await addUser('u1');
    await addUnused('p1', null, { ownerId: 'u1' });
    await addUnused('p2', null, { ownerId: 'u1' });
    await addUnused('p3', null, { ownerId: 'u1' });

    const result = await runUnusedArtifactSweep(e);

    expect(result.notified).toBe(1);
    const ev = await eventForUser('u1');
    expect(ev?.artifact_count).toBe(3);
    expect(JSON.parse(ev!.sample_titles)).toEqual(['p1', 'p2', 'p3']);
    expect(await userLastJanitor('u1')).not.toBeNull();
  });

  it('personal: below threshold still stamps the user cooldown', async () => {
    await addUser('u1');
    await addUnused('p1', null, { ownerId: 'u1' });
    await addUnused('p2', null, { ownerId: 'u1' }); // only 2 — below MIN_UNUSED

    const result = await runUnusedArtifactSweep(e);

    expect(result.notified).toBe(0);
    expect(await eventForUser('u1')).toBeNull();
    expect(await userLastJanitor('u1')).not.toBeNull();
  });

  it('personal: does not re-emit within the 30-day cooldown', async () => {
    await addUser('u1');
    await addUnused('p1', null, { ownerId: 'u1' });
    await addUnused('p2', null, { ownerId: 'u1' });
    await addUnused('p3', null, { ownerId: 'u1' });

    await runUnusedArtifactSweep(e); // notifies + stamps
    const second = await runUnusedArtifactSweep(e); // within cooldown — user not re-selected

    expect(second.notified).toBe(0);
    const n = await e.DB.prepare("SELECT COUNT(*) AS n FROM notifications WHERE recipient_type = 'user' AND recipient_id = ?").bind('u1').first<{ n: number }>();
    expect(n?.n).toBe(1);
  });
});
