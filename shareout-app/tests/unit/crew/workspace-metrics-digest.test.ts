// workspace_metrics_digest on real D1: admin-only guard, one workspace only, real numbers.
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import { workspaceMetricsDigestTool } from '../../../src/crew/tools/workspace-metrics-digest';
import { gatherWorkspaceMetricsDigest, resolveDigestPeriod } from '../../../src/workspaces/metrics-digest';

const NOW = Date.parse('2026-10-19T09:00:00.000Z'); // a Monday
const W1 = 'wsp_wmd_one', W2 = 'wsp_wmd_two', W3 = 'wsp_wmd_empty';
const ADMIN = 'usr_wmd_admin', MEMBER = 'usr_wmd_member', OTHER_ADMIN = 'usr_wmd_other', EMPTY_ADMIN = 'usr_wmd_empty';
const CUR = '2026-10-15T10:00:00.000Z';
const PREV = '2026-10-08T10:00:00.000Z';
const unix = (s: string) => String(Math.floor(Date.parse(s) / 1000));

async function run(sql: string, ...binds: unknown[]) {
  await e.DB.prepare(sql).bind(...binds).run();
}

async function artifact(id: string, ws: string, owner: string, createdAt: string, deletedAt: string | null = null) {
  await run(
    `INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id, `Page ${id}`, `slug-${id}`, owner, ws, createdAt, deletedAt,
  );
}

async function views(artifactId: string, at: string, n: number, prefix: string) {
  for (let i = 0; i < n; i++) {
    await run(
      `INSERT INTO analytics_events (id, artifact_id, event_type, visitor_hash, created_at) VALUES (?, ?, 'view', ?, ?)`,
      `${prefix}_${artifactId}_${i}`, artifactId, `vh_${i % 2}`, at,
    );
  }
}

beforeAll(async () => {
  await applyMigrations();
  for (const [id, email, name] of [
    [ADMIN, 'admin@example.com', 'Ada Admin'],
    [MEMBER, 'member@example.com', 'Max Member'],
    [OTHER_ADMIN, 'other@example.com', 'Olga Other'],
    [EMPTY_ADMIN, 'empty@example.com', 'Eve Empty'],
  ]) {
    await run(`INSERT INTO users (id, email, name) VALUES (?, ?, ?)`, id, email, name);
  }
  await run(`INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'One', 'wmd-one', ?)`, W1, ADMIN);
  await run(`INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'Two', 'wmd-two', ?)`, W2, OTHER_ADMIN);
  await run(`INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'Empty', 'wmd-empty', ?)`, W3, EMPTY_ADMIN);
  await run(`INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES ('wm1', ?, ?, 'admin', '2026-01-01T00:00:00.000Z')`, W1, ADMIN);
  await run(`INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at) VALUES ('wm2', ?, ?, 'member', ?)`, W1, MEMBER, CUR);
  await run(`INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES ('wm3', ?, ?, 'owner')`, W2, OTHER_ADMIN);
  await run(`INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES ('wm4', ?, ?, 'owner')`, W3, EMPTY_ADMIN);

  // W1: one page this week, one last week, one dormant, one deleted this week.
  await artifact('art_wmd_new', W1, MEMBER, CUR);
  await artifact('art_wmd_old', W1, ADMIN, PREV);
  await artifact('art_wmd_dormant', W1, ADMIN, '2026-09-01T00:00:00.000Z');
  await artifact('art_wmd_gone', W1, ADMIN, '2026-09-01T00:00:00.000Z', CUR);
  await run(`INSERT INTO versions (id, artifact_id, version_no, entrypoint, created_at, created_by) VALUES ('ver_wmd_1', 'art_wmd_new', 1, 'index.html', ?, ?)`, CUR, MEMBER);
  await run(`INSERT INTO deployments (id, artifact_id, version_id, channel, slug, updated_at) VALUES ('dep_wmd_1', 'art_wmd_new', 'ver_wmd_1', 'production', 'slug-art_wmd_new', ?)`, CUR);

  // Views: 4 this week on new, 2 last week on old.
  await views('art_wmd_new', CUR, 4, 'cur');
  await views('art_wmd_old', PREV, 2, 'prev');
  // A finalised day: the rollup counts, the leftover raw events for that day do not.
  await run(`INSERT INTO analytics_agg_state (date, completed_at) VALUES ('2026-10-14', ?)`, CUR);
  await run(`INSERT INTO analytics_daily (id, artifact_id, date, views, unique_visitors) VALUES ('ad_wmd', 'art_wmd_old', '2026-10-14', 5, 3)`);
  await views('art_wmd_old', '2026-10-14T12:00:00.000Z', 5, 'agg');

  // Identified viewers: the member twice (both weeks → returning), one external.
  await run(`INSERT INTO viewer_view_events (id, artifact_id, email, viewed_at) VALUES ('vv1', 'art_wmd_new', 'member@example.com', ?)`, CUR);
  await run(`INSERT INTO viewer_view_events (id, artifact_id, email, viewed_at) VALUES ('vv2', 'art_wmd_old', 'Member@example.com', ?)`, CUR);
  await run(`INSERT INTO viewer_view_events (id, artifact_id, email, viewed_at) VALUES ('vv3', 'art_wmd_new', 'client@outside.test', ?)`, CUR);
  await run(`INSERT INTO viewer_view_events (id, artifact_id, email, viewed_at) VALUES ('vv4', 'art_wmd_old', 'member@example.com', ?)`, PREV);

  // AI: agent cost 1.5 USD (crew mode, attributed to the crew owner), plus a transcription.
  await run(`INSERT INTO crews (id, artifact_id, workspace_id, owner_id) VALUES ('crew_wmd', 'art_wmd_new', ?, ?)`, W1, MEMBER);
  await run(
    `INSERT INTO agent_usage_events (id, workspace_id, artifact_id, mode, provider, model, input_tokens, output_tokens, base_cost_micro_usd, crew_id, created_at)
     VALUES ('aue_wmd', ?, 'art_wmd_new', 'crew', 'anthropic', 'm', 1000, 200, 1500000, 'crew_wmd', ?)`, W1, CUR,
  );
  await run(
    `INSERT INTO ai_usage_events (id, workspace_id, user_id, kind, model, units, unit_kind, base_cost_micro_usd, created_at)
     VALUES ('aie_wmd', ?, ?, 'whisper_transcribe', 'w', 30, 'audio_seconds', 250000, ?)`, W1, ADMIN, CUR,
  );
  await run(`INSERT INTO crew_runs (id, crew_id, artifact_id, status, token_input, token_output, cost_micro_usd, started_at) VALUES ('cr_wmd', 'crew_wmd', 'art_wmd_new', 'done', 1000, 200, 1500000, ?)`, CUR);

  // Jobs: one success, two failures of the same job.
  await run(`INSERT INTO scheduled_jobs (id, artifact_id, owner_id, action, schedule, config, next_run_at, title) VALUES ('job_wmd', 'art_wmd_new', ?, 'email', '0 9 * * 1', '{}', '0', 'Weekly mail')`, ADMIN);
  await run(`INSERT INTO job_runs (id, job_id, created_at, status) VALUES ('jr1', 'job_wmd', ?, 'success')`, unix(CUR));
  await run(`INSERT INTO job_runs (id, job_id, created_at, status, error) VALUES ('jr2', 'job_wmd', ?, 'failed', 'SMTP timeout')`, unix(CUR));
  await run(`INSERT INTO job_runs (id, job_id, created_at, status, error) VALUES ('jr3', 'job_wmd', ?, 'failed', 'SMTP timeout')`, unix('2026-10-16T10:00:00.000Z'));

  // Engagement: a thread, a reply, an action item resolved this week, one open overdue.
  await run(`INSERT INTO artifact_comments (id, artifact_id, author_name, content, created_at) VALUES ('c1', 'art_wmd_new', 'Max', 'Looks good', ?)`, CUR);
  await run(`INSERT INTO artifact_comments (id, artifact_id, parent_id, author_name, content, created_at) VALUES ('c2', 'art_wmd_new', 'c1', 'Ada', 'Thanks', ?)`, CUR);
  await run(`INSERT INTO artifact_comments (id, artifact_id, author_name, content, created_at, assignee_email, resolved, resolved_at) VALUES ('c3', 'art_wmd_new', 'Ada', 'Fix chart', ?, 'member@example.com', 1, ?)`, CUR, '2026-10-16T00:00:00.000Z');
  await run(`INSERT INTO artifact_comments (id, artifact_id, author_name, content, created_at, assignee_email, due_at) VALUES ('c4', 'art_wmd_old', 'Ada', 'Add source', ?, 'member@example.com', '2026-10-10T00:00:00.000Z')`, PREV);

  // Storage.
  await run(`INSERT INTO artifact_storage (artifact_id, used_bytes, blob_count) VALUES ('art_wmd_new', 2048, 2)`);
  await run(`INSERT INTO workspace_storage_snapshots (workspace_id, snapshot_date, bytes, max_bytes) VALUES (?, '2026-10-15', 4096, 0)`, W1);

  // W2 noise that must never show up in W1's digest.
  await artifact('art_wmd_foreign', W2, OTHER_ADMIN, CUR);
  await views('art_wmd_foreign', CUR, 9, 'foreign');
  await run(`INSERT INTO viewer_view_events (id, artifact_id, email, viewed_at) VALUES ('vv9', 'art_wmd_foreign', 'secret@other.test', ?)`, CUR);
  await run(
    `INSERT INTO agent_usage_events (id, workspace_id, artifact_id, mode, provider, model, input_tokens, output_tokens, base_cost_micro_usd, created_at)
     VALUES ('aue_wmd_foreign', ?, 'art_wmd_foreign', 'admin', 'anthropic', 'm', 9, 9, 9000000, ?)`, W2, CUR,
  );
});

function ctx(ownerId: string, workspaceId: string) {
  return {
    data: { env: e, artifactId: 'art_wmd_new', viewerScope: null },
    principal: { ownerId, crewId: 'crew_wmd', runId: 'run_wmd', artifactId: 'art_wmd_new', workspaceId },
    limits: {},
  } as never;
}

describe('workspace_metrics_digest guard', () => {
  it('denies a plain member', async () => {
    const r = (await workspaceMetricsDigestTool.execute(ctx(MEMBER, W1), {})) as { error?: string };
    expect(r.error).toMatch(/owners and admins/);
  });

  it("denies another workspace's admin and leaks nothing", async () => {
    const r = await workspaceMetricsDigestTool.execute(ctx(OTHER_ADMIN, W1), {});
    expect(Object.keys(r as object)).toEqual(['error']);
    expect(JSON.stringify(r)).not.toContain('Page art_wmd');
  });

  it('denies a personal artifact (no workspace)', async () => {
    const r = (await workspaceMetricsDigestTool.execute(ctx(ADMIN, ''), {})) as { error?: string };
    expect(r.error).toMatch(/workspace/);
  });

  it('lets a workspace admin through', async () => {
    const r = (await workspaceMetricsDigestTool.execute(ctx(ADMIN, W1), { period: 'previous_week', tz_offset_minutes: -180 })) as {
      period: { kind: string; days: number };
    };
    expect(r.period.kind).toBe('previous_week');
    expect(r.period.days).toBe(7);
  });
});

describe('gatherWorkspaceMetricsDigest', () => {
  it('reports one workspace with real numbers', async () => {
    const d = await gatherWorkspaceMetricsDigest(e, W1, { now: NOW });
    const c = d.current;
    expect(d.period).toMatchObject({ kind: 'last_days', from: '2026-10-12T09:00:00.000Z', to: '2026-10-19T09:00:00.000Z', days: 7 });

    expect(c.artifacts).toMatchObject({ created: 1, deleted: 1, totalLive: 3, versionsPublished: 1, productionDeploysMoved: 1 });
    expect(c.artifacts.new).toEqual([{ name: 'Page art_wmd_new', url: expect.stringContaining('/a/slug-art_wmd_new/'), type: 'html', creator: 'Max Member' }]);

    // 4 live raw views + 5 from the finalised rollup; the 5 leftover raw events are not double-counted.
    expect(c.views.total).toBe(9);
    expect(c.views.identified).toMatchObject({ views: 3, uniqueViewers: 2, internalViewers: 1, externalViewers: 1, externalViews: 1 });
    expect(c.views.topMemberViewers).toEqual([{ name: 'Max Member', email: 'member@example.com', views: 2, artifacts: 2 }]);
    expect(JSON.stringify(d)).not.toContain('client@outside.test');

    expect(c.people).toMatchObject({ membersTotal: 2, newMembers: 1, activeCreators: 1, activeViewers: 2 });
    const max = c.people.members.find((m) => m.email === 'member@example.com')!;
    expect(max).toMatchObject({ artifactsCreated: 1, versionsPublished: 1, viewsGiven: 2, aiTokens: 1200, aiCostUsd: 1.5 });

    expect(c.ai_usage.totalCostUsd).toBe(1.75);
    expect(c.ai_usage.agent).toMatchObject({ inputTokens: 1000, outputTokens: 200, costUsd: 1.5 });
    expect(c.ai_usage.topArtifacts[0]).toMatchObject({ name: 'Page art_wmd_new', costUsd: 1.5 });

    expect(c.jobs).toMatchObject({ runs: 3, byStatus: { success: 1, failed: 2 } });
    expect(c.jobs.failures).toEqual([expect.objectContaining({ job: 'Weekly mail', failures: 2, error: 'SMTP timeout' })]);
    expect(c.jobs.crewRuns).toMatchObject({ runs: 1, costUsd: 1.5 });

    expect(c.engagement).toMatchObject({
      commentsCreated: 3,
      commentThreads: 2,
      commentsResolved: 1,
      actionItems: { created: 1, completed: 1, openAtEnd: 1, overdueAtEnd: 1 },
      returningViewers: 1,
      artifactsViewedByNonCreators: 2,
      dormantArtifacts: 1,
    });
    expect(c.engagement.dormantSample[0].name).toBe('Page art_wmd_dormant');

    expect(d.storage).toMatchObject({ snapshotBytes: 4096, artifactBlobBytes: 2048 });
    expect(d.storage.topArtifacts[0]).toMatchObject({ name: 'Page art_wmd_new', bytes: 2048 });
    expect(d.admins).toEqual([{ name: 'Ada Admin', email: 'admin@example.com', role: 'owner' }]);

    const json = JSON.stringify(d);
    expect(json).not.toContain('art_wmd_foreign');
    expect(json).not.toContain('secret@other.test');
    expect(json).not.toContain('other@example.com');
  });

  it('compares against the previous period', async () => {
    const d = await gatherWorkspaceMetricsDigest(e, W1, { now: NOW });
    expect(d.previous!.views.total).toBe(2);
    expect(d.previous!.artifacts.created).toBe(1);
    expect(d.deltas!.views).toEqual({ current: 9, previous: 2, change: 7, pct: 350 });
    expect(d.deltas!.jobFailures).toMatchObject({ current: 2, previous: 0, pct: null });

    const off = await gatherWorkspaceMetricsDigest(e, W1, { now: NOW, compare: false });
    expect(off.previous).toBeNull();
    expect(off.deltas).toBeNull();
    expect(off.current.engagement.returningViewers).toBeNull();
  });

  it('returns zeros and notes for an empty workspace', async () => {
    const d = await gatherWorkspaceMetricsDigest(e, W3, { now: NOW });
    expect(d.current.artifacts).toMatchObject({ created: 0, deleted: 0, totalLive: 0, new: [] });
    expect(d.current.views.total).toBe(0);
    expect(d.current.ai_usage.totalCostUsd).toBe(0);
    expect(d.current.jobs.runs).toBe(0);
    expect(d.storage.snapshotBytes).toBeNull();
    expect(d.notes.join(' ')).toMatch(/No views recorded/);
    expect(d.notes.join(' ')).toMatch(/workspace_storage_snapshots has no rows/);
    expect(d.admins).toEqual([{ name: 'Eve Empty', email: 'empty@example.com', role: 'owner' }]);
  });
});

describe('resolveDigestPeriod', () => {
  it('previous_week on a Monday morning in UTC-3 is last Monday→Monday local', () => {
    const p = resolveDigestPeriod({ period: 'previous_week', tzOffsetMinutes: -180, now: NOW });
    expect(p).toMatchObject({ from: '2026-10-12T03:00:00.000Z', to: '2026-10-19T03:00:00.000Z', days: 7 });
    expect(p.previous).toEqual({ from: '2026-10-05T03:00:00.000Z', to: '2026-10-12T03:00:00.000Z', days: 7 });
  });

  it('uses the local calendar: 01:00Z Monday is still Sunday in UTC-3', () => {
    const p = resolveDigestPeriod({ period: 'previous_week', tzOffsetMinutes: -180, now: Date.parse('2026-10-19T01:00:00.000Z') });
    expect(p).toMatchObject({ from: '2026-10-05T03:00:00.000Z', to: '2026-10-12T03:00:00.000Z' });
  });

  it('UTC week starts at Monday 00:00Z; days is ignored', () => {
    const p = resolveDigestPeriod({ period: 'previous_week', days: 3, now: Date.parse('2026-10-19T00:00:00.000Z') });
    expect(p).toMatchObject({ from: '2026-10-12T00:00:00.000Z', to: '2026-10-19T00:00:00.000Z', days: 7 });
  });

  it('last_days clamps days to 1..31 and defaults to 7', () => {
    expect(resolveDigestPeriod({ days: 99, now: NOW }).days).toBe(31);
    expect(resolveDigestPeriod({ days: 0, now: NOW }).days).toBe(7);
    expect(resolveDigestPeriod({ compare: false, now: NOW }).previous).toBeNull();
  });
});
