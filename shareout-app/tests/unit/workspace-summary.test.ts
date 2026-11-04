// Admin → Summary on real D1: who may open it (owner, the admins the owner lists, the operator — never
// other admins, members, externals or agent tokens), how the owner keeps that list, and that every number
// is one workspace's, for one calendar month, with AI at the workspace's price.
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import initSql from '../../migrations/0000_init.sql?raw';
import gatewaySql from '../../migrations/0003_ai_gateway_model.sql?raw';
import versionsSql from '../../migrations/0012_version_history.sql?raw';
import tokensSql from '../../migrations/0024_ai_usage_tokens.sql?raw';
import emailSendsSql from '../../migrations/0029_email_sends.sql?raw';
import markupSql from '../../migrations/0035_ai_markup.sql?raw';
import viewersSql from '../../migrations/0039_workspace_summary_viewers.sql?raw';
import {
  handleGetSummary, handleGetSummaryAccess, handleGetSummaryViewers, handleSetSummaryViewers,
} from '../../src/router/api/workspace-summary';
import { monthRange, monthsSince, previousMonthOf } from '../../src/workspaces/usage-summary';
import { invalidateWorkspaceRole } from '../../src/workspaces/roles';
import type { AuthUser } from '../../src/api-auth';
import type { Env } from '../../src/types';

const e = { ...(env as unknown as Env), INSTANCE_ADMIN_EMAILS: 'op@example.com' } as Env;
const WS = 'wsp_sum_acme', OTHER = 'wsp_sum_other';
const as = (id: string, email: string): AuthUser => ({ id, email, username: null });
const OP = as('usr_sum_op', 'op@example.com');
const OWNER = as('usr_sum_owner', 'owner@acme.test');
const ADMIN_A = as('usr_sum_admin_a', 'admin_a@acme.test');
const ADMIN_B = as('usr_sum_admin_b', 'admin_b@acme.test');
const MEMBER = as('usr_sum_member', 'member@acme.test');
const EXTERNAL = as('usr_sum_ext', 'ext@partner.test');
const STRANGER = as('usr_sum_stranger', 'boss@other.test');
const AGENT = { ...OWNER, service: { scopes: ['publish'] } } as unknown as AuthUser;

const get = (qs = '') => new Request(`https://shareout.test/v1/workspaces/${WS}/summary${qs}`);
const put = (body: unknown) => new Request(`https://shareout.test/v1/workspaces/${WS}/summary/viewers`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const read = async (res: Response) => ({ status: res.status, body: (await res.json()) as any });
const summary = (u: AuthUser, month = '2026-10') => handleGetSummary(get(`?month=${month}`), e, u, WS).then(read);
const ts = (d: string) => `${d}.000Z`;

beforeAll(async () => {
  for (const sql of [initSql, gatewaySql, versionsSql, tokensSql, emailSendsSql, markupSql, viewersSql]) {
    const stmts = sql.replace(/--[^\n]*/g, '').split(/;\s*\n/).map((x) => x.trim()).filter(Boolean);
    for (let i = 0; i < stmts.length; i += 50) await e.DB.batch(stmts.slice(i, i + 50).map((x) => e.DB.prepare(x)));
  }
  const run = (sql: string, ...args: unknown[]) => e.DB.prepare(sql).bind(...args).run();
  for (const u of [OP, OWNER, ADMIN_A, ADMIN_B, MEMBER, EXTERNAL, STRANGER]) {
    await run('INSERT INTO users (id, email, name) VALUES (?, ?, ?)', u.id, u.email, u.email.split('@')[0]);
  }
  await run(`INSERT INTO workspaces (id, name, slug, owner_id, created_at) VALUES (?, 'Acme', 'acme-sum', ?, '2026-09-15T12:00:00.000Z'),
             (?, 'Other', 'other-sum', ?, '2026-09-01T00:00:00.000Z')`, WS, OWNER.id, OTHER, STRANGER.id);
  const member = (id: string, ws: string, u: AuthUser, role: string, joined: string, cls = 'internal') =>
    run('INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, ws, u.id, role, cls, ts(joined));
  await member('wm_s1', WS, OWNER, 'owner', '2026-09-15T12:00:00');
  await member('wm_s2', WS, ADMIN_A, 'admin', '2026-09-16T12:00:00');
  await member('wm_s3', WS, ADMIN_B, 'admin', '2026-10-02T12:00:00');
  await member('wm_s4', WS, MEMBER, 'member', '2026-10-03T12:00:00');
  await member('wm_s5', WS, EXTERNAL, 'admin', '2026-10-03T12:00:00', 'external');
  await member('wm_s6', OTHER, STRANGER, 'owner', '2026-09-01T00:00:00');

  const art = (id: string, ws: string, owner: AuthUser, created: string, deleted: string | null = null) =>
    run('INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id, `Page ${id}`, `slug-${id}`, owner.id, ws, 'workspace', ts(created), deleted && ts(deleted));
  await art('art_s1', WS, OWNER, '2026-09-20T10:00:00');
  await art('art_s2', WS, ADMIN_A, '2026-10-05T10:00:00');
  await art('art_s3', WS, MEMBER, '2026-10-10T10:00:00', '2026-10-20T10:00:00');
  await art('art_so', OTHER, STRANGER, '2026-10-05T10:00:00');

  const ver = (id: string, a: string, no: number, at: string, by: AuthUser) =>
    run("INSERT INTO versions (id, artifact_id, version_no, entrypoint, created_at, created_by) VALUES (?, ?, ?, 'index.html', ?, ?)", id, a, no, ts(at), by.id);
  await ver('v_s1', 'art_s1', 1, '2026-09-20T10:00:00', OWNER);
  await ver('v_s2', 'art_s1', 2, '2026-10-02T10:00:00', OWNER);
  await ver('v_s3', 'art_s2', 1, '2026-10-05T10:00:00', ADMIN_A);
  await ver('v_s4', 'art_s2', 2, '2026-10-06T10:00:00', ADMIN_A);
  await ver('v_s5', 'art_s3', 1, '2026-10-10T10:00:00', MEMBER);
  await ver('v_so', 'art_so', 1, '2026-10-05T10:00:00', STRANGER);

  let n = 0;
  const view = (a: string, email: string, at: string) => run('INSERT INTO viewer_view_events (id, artifact_id, email, viewed_at) VALUES (?, ?, ?, ?)', `vv_s${n++}`, a, email, ts(at));
  await view('art_s1', 'admin_a@acme.test', '2026-10-03T09:00:00');
  await view('art_s1', 'Admin_A@acme.test', '2026-10-03T10:00:00');
  await view('art_s1', 'admin_a@acme.test', '2026-10-07T10:00:00');
  await view('art_s1', 'member@acme.test', '2026-10-08T10:00:00');
  await view('art_s1', 'reader@partner.test', '2026-10-08T11:00:00');
  await view('art_s1', 'reader@partner.test', '2026-10-09T11:00:00');
  await view('art_s2', 'owner@acme.test', '2026-10-31T23:59:59');
  await view('art_s1', 'member@acme.test', '2026-09-30T23:59:59');
  await view('art_s1', 'member@acme.test', '2026-11-01T00:00:00');
  await view('art_so', 'boss@other.test', '2026-10-05T10:00:00');
  await run("INSERT INTO analytics_daily (id, artifact_id, date, views, unique_visitors) VALUES ('ad_s1', 'art_s1', '2026-10-03', 10, 4), ('ad_so', 'art_so', '2026-10-03', 99, 9)");

  await run("INSERT INTO workspace_llm_config (workspace_id, ai_markup_bps) VALUES (?, 15000)", WS);
  const usage = (ws: string, u: AuthUser | null, kind: string, at: string, cost: number) =>
    run(`INSERT INTO ai_usage_events (id, workspace_id, user_id, kind, model, units, unit_kind, base_cost_micro_usd, created_at)
         VALUES (?, ?, ?, ?, 'm', 0, 'tokens', ?, ?)`, crypto.randomUUID(), ws, u?.id ?? null, kind, cost, ts(at));
  await usage(WS, OWNER, 'knowledge_search', '2026-10-03T10:00:00', 1_000_000);
  await usage(WS, ADMIN_A, 'assistant_chat', '2026-10-04T10:00:00', 2_000_000);
  await usage(WS, null, 'knowledge_extraction', '2026-10-04T11:00:00', 500_000);
  await usage(WS, ADMIN_A, 'assistant_chat', '2026-09-25T10:00:00', 1_000_000);
  await usage(OTHER, STRANGER, 'assistant_chat', '2026-10-04T10:00:00', 9_000_000);

  await run(`INSERT INTO agent_threads (id, scope_type, scope_key, user_id, created_at) VALUES
    ('th_s1', 'workspace', ?, ?, '2026-10-04T10:00:00.000Z'), ('th_s2', 'artifact_visitor', 'art_s1', NULL, '2026-10-05T10:00:00.000Z'),
    ('th_so', 'workspace', ?, ?, '2026-10-04T10:00:00.000Z')`, WS, ADMIN_A.id, OTHER, STRANGER.id);
  await run(`INSERT INTO agent_messages (id, thread_id, role, content, created_at) VALUES
    ('m_s1', 'th_s1', 'user', 'q1', '2026-10-04T10:00:00.000Z'), ('m_s2', 'th_s1', 'assistant', 'a1', '2026-10-04T10:00:01.000Z'),
    ('m_s3', 'th_s1', 'user', 'q2', '2026-10-04T10:05:00.000Z'), ('m_s4', 'th_s2', 'user', 'q3', '2026-10-05T10:00:00.000Z'),
    ('m_so', 'th_so', 'user', 'q4', '2026-10-04T10:00:00.000Z')`);

  const file = (ns: string, path: string, created: string, updated: string) =>
    run("INSERT INTO workspace_files (workspace_id, namespace, path, content, created_at, updated_at) VALUES (?, ?, ?, '# x', ?, ?)", WS, ns, path, ts(created), ts(updated));
  await file('knowledge', 'a.md', '2026-09-20T10:00:00', '2026-09-20T10:00:00');
  await file('knowledge', 'b.md', '2026-09-21T10:00:00', '2026-10-11T10:00:00');
  await file('knowledge', 'c.md', '2026-10-12T10:00:00', '2026-10-12T10:00:00');
  await file('catalog', 'metric.md', '2026-10-12T10:00:00', '2026-10-12T10:00:00');
  await run(`INSERT INTO asset_deliverables (id, bucket_artifact_id, workspace_id, owner_id, name, created_at, deleted_at) VALUES
    ('dlv_s1', 'art_s1', ?, ?, 'a.pdf', '2026-10-12T10:00:00.000Z', NULL), ('dlv_s2', 'art_s1', ?, ?, 'b.pdf', '2026-10-13T10:00:00.000Z', '2026-11-02T10:00:00.000Z')`,
    WS, MEMBER.id, WS, MEMBER.id);
  await run("INSERT INTO artifact_comments (id, artifact_id, author_id, author_name, content, created_at) VALUES ('c_s1', 'art_s1', ?, 'member', 'hi', '2026-10-14T10:00:00.000Z')", MEMBER.id);

  await run("INSERT INTO scheduled_jobs (id, artifact_id, owner_id, action, schedule, config, next_run_at) VALUES ('job_s1', 'art_s1', ?, 'http_get', '0 9 * * *', '{}', '2026-12-01T00:00:00.000Z')", OWNER.id);
  const sec = (d: string) => String(Math.floor(Date.parse(ts(d)) / 1000)); // job_runs.created_at is unix seconds
  await run("INSERT INTO job_runs (id, job_id, created_at, status) VALUES ('jr_s1', 'job_s1', ?, 'success'), ('jr_s2', 'job_s1', ?, 'failed'), ('jr_s3', 'job_s1', ?, 'success')",
    sec('2026-10-02T09:00:00'), sec('2026-10-03T09:00:00'), sec('2026-09-28T09:00:00'));
});

describe('month helpers', () => {
  it('bounds a month and steps back across a year', () => {
    expect(monthRange('2026-12')).toEqual({ from: '2026-12-01', to: '2027-01-01' });
    expect(previousMonthOf('2026-01')).toBe('2025-12');
    expect(monthsSince('2026-09-15T12:00:00.000Z', new Date('2026-11-04T00:00:00Z'))).toEqual(['2026-11', '2026-10', '2026-09']);
    expect(monthsSince(null, new Date('2026-11-04T00:00:00Z'))).toEqual(['2026-11']);
  });
});

describe('who may open the summary', () => {
  it('the owner and the operator can, and manage the list', async () => {
    for (const u of [OWNER, OP]) {
      const r = await summary(u);
      expect(r.status, u.email).toBe(200);
      expect(r.body.can_manage).toBe(true);
    }
  });

  it('no other admin, member, external, outsider or agent token can until listed', async () => {
    for (const u of [ADMIN_A, ADMIN_B, MEMBER, EXTERNAL, STRANGER, AGENT]) {
      expect((await summary(u)).status, u.email).toBe(403);
      expect((await read(await handleGetSummaryAccess(e, u, WS))).body).toEqual({ can_view: false, can_manage: false });
    }
  });

  it('the owner lists an admin; that admin can read it but not change who else can', async () => {
    const r = await read(await handleSetSummaryViewers(put({ user_ids: [ADMIN_A.id] }), e, OWNER, WS));
    expect(r.status).toBe(200);
    expect(r.body.viewers.map((v: any) => [v.user_id, v.can_view])).toEqual(
      expect.arrayContaining([[OWNER.id, true], [ADMIN_A.id, true], [ADMIN_B.id, false]]),
    );
    expect((await summary(ADMIN_A)).body.can_manage).toBe(false);
    expect((await read(await handleGetSummaryAccess(e, ADMIN_A, WS))).body).toEqual({ can_view: true, can_manage: false });
    expect((await summary(ADMIN_B)).status).toBe(403);
    expect((await handleSetSummaryViewers(put({ user_ids: [ADMIN_A.id, ADMIN_B.id] }), e, ADMIN_A, WS)).status).toBe(403);
    expect((await handleGetSummaryViewers(e, ADMIN_A, WS)).status).toBe(403);
    const log = await e.DB.prepare("SELECT detail FROM audit_log WHERE workspace_id = ? AND action = 'summary.viewers_update'").bind(WS).first<{ detail: string }>();
    expect(JSON.parse(log!.detail)).toEqual({ added: [ADMIN_A.id], removed: [] });
  });

  it('only internal admins can be listed', async () => {
    for (const id of [MEMBER.id, EXTERNAL.id, STRANGER.id, OWNER.id]) {
      expect((await handleSetSummaryViewers(put({ user_ids: [ADMIN_A.id, id] }), e, OWNER, WS)).status, id).toBe(400);
    }
    expect((await handleSetSummaryViewers(put({ user_ids: 'usr_x' }), e, OWNER, WS)).status).toBe(400);
  });

  it('a listed admin who is demoted loses it without the row being touched', async () => {
    await e.DB.prepare("UPDATE workspace_members SET role = 'member' WHERE id = 'wm_s2'").run();
    await invalidateWorkspaceRole(e, WS, ADMIN_A.id);
    expect((await summary(ADMIN_A)).status).toBe(403);
    await e.DB.prepare("UPDATE workspace_members SET role = 'admin' WHERE id = 'wm_s2'").run();
    await invalidateWorkspaceRole(e, WS, ADMIN_A.id);
    expect((await summary(ADMIN_A)).status).toBe(200);
  });

  it('removing an admin from the list closes it again', async () => {
    expect((await handleSetSummaryViewers(put({ user_ids: [] }), e, OWNER, WS)).status).toBe(200);
    expect((await summary(ADMIN_A)).status).toBe(403);
  });

  it('rejects a malformed month', async () => {
    expect((await summary(OWNER, '2026-13')).status).toBe(400);
  });
});

describe('the October report', () => {
  it('counts one workspace, one month, at the workspace price', async () => {
    const { body: d } = await summary(OWNER);
    expect(d.month).toBe('2026-10');
    expect(d.months).toEqual(expect.arrayContaining(['2026-10', '2026-09']));
    expect(d.months.at(-1)).toBe('2026-09');
    expect(d.people).toEqual({ members: 4, active: 3, new_members: 2, outside_readers: 1 });
    expect(d.visits).toMatchObject({ views: 7, readers: 4, all_views: 10 });
    expect(d.visits.daily).toEqual([
      { day: '2026-10-03', views: 2 }, { day: '2026-10-07', views: 1 }, { day: '2026-10-08', views: 2 }, { day: '2026-10-09', views: 1 }, { day: '2026-10-31', views: 1 },
    ]);
    expect(d.visits.top_pages[0]).toMatchObject({ id: 'art_s1', views: 6, readers: 3, owner_email: OWNER.email, deleted: false });
    expect(d.pages).toEqual({ live: 2, created: 2, deleted: 1, publishes: 4, pages_updated: 3 });
    expect(d.knowledge).toEqual({
      notes: { total: 3, added: 1, updated: 1 }, catalog: { total: 1, added: 1, updated: 0 }, files: { live: 2, added: 2 }, lookups: 1,
    });
    expect(d.ai).toEqual({ questions: 3, conversations: 2, spend_usd: 5.25, people: 2 });
    expect(d.automations).toEqual({ job_runs: 2, job_failed: 1, crew_runs: 0, crew_failed: 0, emails_sent: 0 });
    expect(d.outside).toEqual({ people: 1, views: 2, top: [{ email: 'reader@partner.test', views: 2, last_at: '2026-10-09T11:00:00.000Z' }] });
  });

  it('breaks it down per member', async () => {
    const { body: d } = await summary(OWNER);
    const by = Object.fromEntries(d.members.map((m: any) => [m.user_id, m]));
    expect(Object.keys(by).sort()).toEqual([ADMIN_A.id, ADMIN_B.id, MEMBER.id, OWNER.id].sort());
    expect(by[ADMIN_A.id]).toMatchObject({ views: 3, pages_created: 1, publishes: 2, ai_questions: 2, knowledge_lookups: 0, ai_spend_usd: 3, files: 0 });
    expect(by[ADMIN_A.id].last_active_at).toBe('2026-10-07T10:00:00.000Z');
    expect(by[MEMBER.id]).toMatchObject({ views: 1, pages_created: 1, publishes: 1, files: 2, comments: 1 });
    expect(by[OWNER.id]).toMatchObject({ views: 1, publishes: 1, knowledge_lookups: 1, ai_spend_usd: 1.5, last_active_at: '2026-10-31T23:59:59.000Z' });
    expect(by[ADMIN_B.id]).toMatchObject({ views: 0, publishes: 0, last_active_at: null });
  });

  it('compares with the month before', async () => {
    const { body: d } = await summary(OWNER);
    expect(d.previous).toEqual({
      month: '2026-09', active_people: 3, views: 1, readers: 1, publishes: 1, pages_created: 1, ai_questions: 0, ai_spend_usd: 1.5,
    });
  });
});
