// @vitest-environment node
// Trashed artifacts (deleted_at set, slug '__deleted__' || id) must not surface in
// search, the chat agent's listings, or the home activity feed. Runs against the
// real migrated schema.
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, e } from './helpers/migrated-db';
import { quickSearch } from '../../src/search/quick-search';
import { listArtifactsForUser } from '../../src/chat-agent/tools/artifacts';
import { listWorkspacesForUser, resolveArtifactAccessForUser } from '../../src/chat-agent/access';
import { queryActivityFeed } from '../../src/pages/home/queries/activity-feed';
import { queryRecentActivity } from '../../src/pages/home/queries/activity-panels';

const user = { id: 'usr_trash', email: 'trash@example.com' };
const WS = 'wsp_trash';

beforeAll(async () => {
  await applyMigrations();
  const now = new Date().toISOString();
  const stmts = [
    e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(user.id, user.email, 'Trash'),
    e.DB.prepare('INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, ?, ?, ?)').bind(WS, 'Trash WS', 'trash-ws', user.id),
    e.DB.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'owner')").bind(WS, user.id),
  ];
  for (const [id, name, deleted] of [['art_live', 'Revenue live', null], ['art_gone', 'Revenue trashed', now]] as const) {
    stmts.push(
      e.DB.prepare(`INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility, deleted_at)
                    VALUES (?, ?, ?, ?, ?, 'workspace', ?)`)
        .bind(id, name, deleted ? `__deleted__${id}` : id, user.id, WS, deleted),
      e.DB.prepare("INSERT INTO versions (id, artifact_id, version_no, entrypoint) VALUES (?, ?, 1, 'index.html')").bind(`ver_${id}`, id),
      e.DB.prepare("INSERT INTO analytics_events (id, artifact_id, event_type, visitor_hash) VALUES (?, ?, 'view', 'v')").bind(`ev_${id}`, id),
    );
  }
  stmts.push(
    e.DB.prepare("INSERT INTO connections (id, scope_type, scope_id, name, provider) VALUES ('cn_1', 'artifact', 'art_live', 'db', 'postgres')"),
    e.DB.prepare(`INSERT INTO scheduled_jobs (id, artifact_id, owner_id, action, schedule, config, next_run_at)
                  VALUES ('job_1', 'art_live', ?, 'email', '0 9 * * *', '{}', ?)`).bind(user.id, now),
    e.DB.prepare("INSERT INTO job_runs (id, job_id, status) VALUES ('run_ok', 'job_1', 'success'), ('run_bad', 'job_1', 'failed')"),
  );
  await e.DB.batch(stmts);
});

describe('trashed artifacts are excluded', () => {
  it('/v1/search (quickSearch) skips them, in a workspace and across everything', async () => {
    for (const workspaceId of [WS, undefined]) {
      const res = await quickSearch(e, user.id, { q: 'Revenue', workspaceId, groups: ['artifacts'] });
      expect(res.artifacts.map((h) => h.id)).toEqual(['art_live']);
    }
  });

  it('the chat agent list/search tools and workspace counts skip them', async () => {
    const listed = await listArtifactsForUser(e, user.id, { limit: 50, workspaceId: WS });
    expect(listed.map((a) => a.id)).toEqual(['art_live']);
    const searched = await listArtifactsForUser(e, user.id, { limit: 50, search: 'Revenue' });
    expect(searched.map((a) => a.id)).toEqual(['art_live']);
    const [ws] = await listWorkspacesForUser(e, user.id);
    expect(ws.artifactCount).toBe(1);
  });

  it('agent tools cannot open a trashed artifact by id', async () => {
    expect(await resolveArtifactAccessForUser(e, 'art_gone', user.id)).toBeNull();
    expect(await resolveArtifactAccessForUser(e, 'art_live', user.id)).not.toBeNull();
  });
});

describe('home activity feed runs against the real schema', () => {
  it('returns pulse (incl. views) for live artifacts only, in a workspace and personally', async () => {
    const feed = await queryActivityFeed(e, user, { workspaceId: WS, window: '7d' });
    const ids = new Set(feed.pulse.map((p) => p.artifact_id));
    expect(ids.has('art_live')).toBe(true);
    expect(ids.has('art_gone')).toBe(false);
    const recent = (ts: number) => Math.abs(ts - Date.now() / 1000) < 3600;
    for (const kind of ['view', 'connection', 'run'] as const) {
      const ev = feed.pulse.find((p) => p.kind === kind);
      expect(ev?.artifact_id, kind).toBe('art_live');
      expect(recent(ev!.ts), `${kind} ts is unix seconds`).toBe(true);
    }
    const failed = feed.needs.find((n) => n.kind === 'run');
    expect(failed && recent(failed.ts), 'failed run ts is unix seconds').toBe(true);
    await expect(queryActivityFeed(e, user, { window: '30d' })).resolves.toBeTruthy();
  });

  it('recent view activity reads analytics_events.created_at', async () => {
    const rows = await queryRecentActivity(e, user, WS);
    expect(rows.map((r) => r.slug)).toEqual(['art_live']);
    expect(Number.isNaN(Date.parse(String(rows[0].timestamp)))).toBe(false);
  });
});
