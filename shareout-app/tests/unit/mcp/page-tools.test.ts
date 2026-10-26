// Page tools over MCP against the real migrated schema and the real REST handlers:
// version history / source / restore, comments resolve / assign, approvals and the
// page's schedules — each allowed for the right person and denied for the wrong one.
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { AuthUser } from '../../../src/api-auth';
import { callTool, listTools } from '../../../src/mcp/tools';
import { applyMigrations, e } from '../helpers/migrated-db';

const WS = 'wsp_mcpp';
const ART = 'art_mcpp';
const C1 = 'cmt_' + 'c3'.repeat(12);
const u = (id: string, email: string): AuthUser => ({ id, email, username: null });
const alice = u('usr_mcpp_alice', 'alice@example.com'); // owner
const bob = u('usr_mcpp_bob', 'bob@example.com');       // internal member + editor
const carol = u('usr_mcpp_carol', 'carol@example.com'); // viewer collaborator
const dave = u('usr_mcpp_dave', 'dave@example.com');    // internal member, no artifact role
const erin = u('usr_mcpp_erin', 'erin@example.com');    // stranger

const ctx = (user: AuthUser) => ({ env: e, user, origin: 'https://shareout.test', authorization: 'Bearer so_test' });
const call = (user: AuthUser, name: string, args: Record<string, unknown>) => callTool(ctx(user), name, args).then((r) => r!);
const versionCount = async () => (await e.DB.prepare('SELECT COUNT(*) AS n FROM versions WHERE artifact_id = ?').bind(ART).first<{ n: number }>())!.n;

beforeAll(async () => {
  await applyMigrations();
  const html1 = '<h1>One</h1>';
  const html2 = '<h1>Two</h1>';
  await env.ARTIFACTS.put(`${ART}/ver_mcpp1/index.html`, html1);
  await env.ARTIFACTS.put(`${ART}/ver_mcpp2/index.html`, html2);
  await e.DB.batch([
    ...[alice, bob, carol, dave, erin].map((x) => e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(x.id, x.email, x.email!.split('@')[0])),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'Acme', 'acme-mcpp', ?)").bind(WS, alice.id),
    e.DB.prepare(`INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES
      ('wm_mcpp1', ?, ?, 'owner', 'internal'), ('wm_mcpp2', ?, ?, 'member', 'internal'), ('wm_mcpp3', ?, ?, 'member', 'internal')`)
      .bind(WS, alice.id, WS, bob.id, WS, dave.id),
    e.DB.prepare("INSERT INTO artifacts (id, owner_id, name, slug, visibility, workspace_id) VALUES (?, ?, 'Plan', 'mcpp-plan', 'workspace', ?)").bind(ART, alice.id, WS),
    e.DB.prepare("INSERT INTO collaborators (id, artifact_id, email, role) VALUES ('col_mcpp1', ?, ?, 'editor'), ('col_mcpp2', ?, ?, 'viewer')")
      .bind(ART, bob.email, ART, carol.email),
    e.DB.prepare(`INSERT INTO versions (id, artifact_id, version_no, entrypoint, manifest_json, created_at, created_by, source, message, message_source)
      VALUES ('ver_mcpp1', ?, 1, 'index.html', '{}', '2026-01-01T00:00:00.000Z', ?, 'api', 'First draft', 'author'),
             ('ver_mcpp2', ?, 2, 'index.html', '{}', '2026-01-02T00:00:00.000Z', ?, 'editor', NULL, NULL)`).bind(ART, alice.id, ART, bob.id),
    e.DB.prepare(`INSERT INTO assets (id, version_id, path, r2_key, mime, size_bytes, sha256)
      VALUES ('ast_mcpp1', 'ver_mcpp1', 'index.html', ?, 'text/html', ?, 'h1'), ('ast_mcpp2', 'ver_mcpp2', 'index.html', ?, 'text/html', ?, 'h2')`)
      .bind(`${ART}/ver_mcpp1/index.html`, html1.length, `${ART}/ver_mcpp2/index.html`, html2.length),
    e.DB.prepare("INSERT INTO deployments (id, artifact_id, version_id, channel, slug) VALUES ('dep_mcpp', ?, 'ver_mcpp2', 'production', 'mcpp-plan')").bind(ART),
    e.DB.prepare(`INSERT INTO artifact_comments (id, artifact_id, author_id, author_name, content, created_at, updated_at, version_id)
      VALUES (?, ?, ?, 'Alice', 'Tighten the intro', '2026-01-01T01:00:00.000Z', '2026-01-01T01:00:00.000Z', 'ver_mcpp1')`).bind(C1, ART, alice.id),
    e.DB.prepare(`INSERT INTO scheduled_jobs (id, artifact_id, owner_id, action, schedule, config, next_run_at, title) VALUES
      ('job_mcpp_team', ?, ?, 'email', '0 9 * * 1', '{"recipients":["team@example.com","boss@example.com"]}', '2026-02-01T09:00:00Z', 'Weekly to the team'),
      ('job_mcpp_bobdm', ?, ?, 'slack', '0 8 * * *', '{"targetType":"dm","slackUserId":"U1"}', '2026-02-01T08:00:00Z', 'Bob DM'),
      ('job_mcpp_alicedm', ?, ?, 'slack', '0 7 * * *', '{"targetType":"dm","slackUserId":"U2"}', '2026-02-01T07:00:00Z', 'Alice DM')`)
      .bind(ART, alice.id, ART, bob.id, ART, alice.id),
  ]);
});

describe('tool list', () => {
  it('exposes the page tools with honest read-only hints', () => {
    const tools = new Map(listTools().map((t) => [t.name, t]));
    for (const name of ['list_versions', 'get_version_source', 'list_comments', 'list_jobs']) expect(tools.get(name)?.annotations.readOnlyHint).toBe(true);
    for (const name of ['restore_version', 'resolve_comment', 'assign_comment', 'approve_version']) expect(tools.get(name)?.annotations.readOnlyHint).toBe(false);
  });
});

describe('list_versions / get_version_source', () => {
  it('a viewer sees the history with notes, comment counts and the live version', async () => {
    const r = await call(carol, 'list_versions', { artifact_id: ART });
    expect(r.isError).toBeUndefined();
    expect(r.content[0].text).toContain('v2 (live)');
    expect(r.content[0].text).toContain('"First draft"');
    expect(r.content[0].text).toContain('1 comments');
    expect(r.structuredContent!.live_version_id).toBe('ver_mcpp2');
    const src = await call(carol, 'get_version_source', { artifact_id: ART, version_no: 1 });
    expect(src.content[0].text).toContain('<h1>One</h1>');
  });

  it('a stranger gets neither', async () => {
    const r = await call(erin, 'list_versions', { artifact_id: ART });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ status: 403 });
    const src = await call(erin, 'get_version_source', { artifact_id: ART, version_no: 1 });
    expect(src.isError).toBe(true);
    expect(src.content[0].text).not.toContain('<h1>One</h1>');
  });
});

describe('get_artifact source', () => {
  it('reads with the viewer gate of the files endpoint: a collaborator gets it, a member without a role does not', async () => {
    const r = await call(carol, 'get_artifact', { artifact_id: ART, include_content: true });
    expect(r.structuredContent).toMatchObject({ version: 2, content: '<h1>Two</h1>', truncated: false });
    const member = await call(dave, 'get_artifact', { artifact_id: ART, include_files: true });
    expect(member.isError).toBeUndefined();
    expect(member.content[0].text).toContain('Its files are not shown');
    expect(member.structuredContent).not.toHaveProperty('files');
  });
});

describe('restore_version', () => {
  it('denies a viewer and creates no version', async () => {
    const r = await call(carol, 'restore_version', { artifact_id: ART, version_no: 1 });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(await versionCount()).toBe(2);
  });

  it('lets an editor bring v1 back as a new live version, with a note', async () => {
    const r = await call(bob, 'restore_version', { artifact_id: ART, version_no: 1, message: 'Back to the draft' });
    expect(r.isError).toBeUndefined();
    expect(r.content[0].text).toContain('Restored version 1 as the new version 3');
    const v3 = await e.DB.prepare('SELECT id, source, message FROM versions WHERE artifact_id = ? AND version_no = 3').bind(ART).first<{ id: string; source: string; message: string }>();
    expect(v3).toMatchObject({ source: 'restore', message: 'Back to the draft' });
    const live = await e.DB.prepare("SELECT version_id FROM deployments WHERE artifact_id = ? AND channel = 'production'").bind(ART).first<{ version_id: string }>();
    expect(live?.version_id).toBe(v3!.id);
  });
});

describe('comments', () => {
  it('list_comments shows threads with ids to someone who can see the page, nothing to a stranger', async () => {
    const r = await call(dave, 'list_comments', { artifact_id: ART });
    expect(r.content[0].text).toContain(C1);
    expect(r.content[0].text).toContain('on v1');
    const none = await call(erin, 'list_comments', { artifact_id: ART });
    expect(none.content[0].text).toMatch(/No comments/);
    expect(none.structuredContent!.comments).toEqual([]);
  });

  it('resolve_comment: denied to a stranger (row unchanged), allowed to a member who is not the author', async () => {
    const denied = await call(erin, 'resolve_comment', { artifact_id: ART, comment_id: C1 });
    expect(denied.isError).toBe(true);
    expect(denied.content[0].text).toMatch(/comment access/);
    expect((await e.DB.prepare('SELECT resolved FROM artifact_comments WHERE id = ?').bind(C1).first<{ resolved: number }>())!.resolved).toBe(0);

    const r = await call(dave, 'resolve_comment', { artifact_id: ART, comment_id: C1 });
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent).toMatchObject({ resolved: 1, resolved_by: dave.email });
    expect((await call(dave, 'list_comments', { artifact_id: ART, open_only: true })).content[0].text).toMatch(/No comments/);
    expect((await call(dave, 'resolve_comment', { artifact_id: ART, comment_id: C1, resolved: false })).structuredContent).toMatchObject({ resolved: 0 });
  });

  it('assign_comment: denied to a stranger, refuses someone not on the page, assigns a member', async () => {
    expect((await call(erin, 'assign_comment', { artifact_id: ART, comment_id: C1, assignee: bob.email })).isError).toBe(true);
    const nobody = await call(dave, 'assign_comment', { artifact_id: ART, comment_id: C1, assignee: 'nobody@example.com' });
    expect(nobody.isError).toBe(true);
    expect(nobody.structuredContent).toMatchObject({ code: 'ASSIGNEE_NOT_FOUND' });
    const r = await call(dave, 'assign_comment', { artifact_id: ART, comment_id: C1, assignee: bob.email });
    expect(r.structuredContent).toMatchObject({ assignee_email: bob.email });
    expect((await call(dave, 'assign_comment', { artifact_id: ART, comment_id: C1, assignee: null })).structuredContent).toMatchObject({ assignee_email: null });
  });
});

describe('approve_version', () => {
  it('checks comment access before saying a version is missing', async () => {
    const r = await call(erin, 'approve_version', { artifact_id: ART, version_no: 99 });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ status: 403 });
    expect((await call(dave, 'approve_version', { artifact_id: ART, version_no: 99 })).structuredContent).toMatchObject({ status: 404, code: 'VERSION_NOT_FOUND' });
  });

  it('records a member approval of a numbered version, then withdraws it', async () => {
    const r = await call(dave, 'approve_version', { artifact_id: ART, version_no: 1 });
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent!.my_approvals).toEqual(['ver_mcpp1']);
    const n = async () => (await e.DB.prepare('SELECT COUNT(*) AS n FROM artifact_approvals WHERE artifact_id = ? AND user_id = ?').bind(ART, dave.id).first<{ n: number }>())!.n;
    expect(await n()).toBe(1);
    await call(dave, 'approve_version', { artifact_id: ART, version_no: 1, approved: false });
    expect(await n()).toBe(0);
  });
});

describe('list_jobs', () => {
  it("the owner sees shared schedules and their own DM, never someone else's DM", async () => {
    const r = await call(alice, 'list_jobs', { artifact_id: ART });
    const ids = (r.structuredContent!.jobs as Array<{ id: string }>).map((j) => j.id).sort();
    expect(ids).toEqual(['job_mcpp_alicedm', 'job_mcpp_team']);
  });

  it('someone without a role on the page sees none of the others’ schedules', async () => {
    const r = await call(dave, 'list_jobs', { artifact_id: ART });
    expect(r.structuredContent!.jobs).toEqual([]);
    expect(r.content[0].text).toBe('No schedules found.');
  });
});
