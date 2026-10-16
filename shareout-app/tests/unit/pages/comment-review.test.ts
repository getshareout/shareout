// Comment review workflow against the real migrated schema: resolve/reopen, assign,
// version anchoring and approvals — and who may do each (comment access).
import { beforeAll, describe, expect, it } from 'vitest';
import type { AuthUser } from '../../../src/api-auth';
import { handleGetVersions } from '../../../src/artifacts';
import { canReviewArtifact } from '../../../src/data/comments/review-access';
import { resolveComment, assignComment } from '../../../src/data/comments/actions';
import type { DataContext } from '../../../src/data/middleware';
import { addArtifactComment, queryArtifactComments } from '../../../src/pages/home/queries/comments';
import { queryActionItems } from '../../../src/pages/home/queries/activity-feed';
import { queryReviewState, setApproval, setCommentAssignee, setCommentResolved } from '../../../src/pages/home/queries/review';
import { handleHomeApprovalApi, handleHomeCommentResolveApi } from '../../../src/pages/home/review-api';
import { createSessionToken } from '../../../src/token';
import { applyMigrations, e } from '../helpers/migrated-db';

const WS = 'ws_rv';
const ART = 'art_rv';
const OTHER = 'art_rv_other';
const owner = { id: 'usr_rv_owner', email: 'alice@example.com' };
const member = { id: 'usr_rv_member', email: 'bob@example.com' };
const viewer = { id: 'usr_rv_viewer', email: 'carol@example.com' };   // external, view grant only
const reviewer = { id: 'usr_rv_reviewer', email: 'dave@example.com' }; // external, comment grant
const stranger = { id: 'usr_rv_stranger', email: 'erin@example.com' };
const C1 = 'cmt_' + 'a1'.repeat(12);
const C_OTHER = 'cmt_' + 'b2'.repeat(12);

const post = (body: unknown) => new Request('https://x.test', { method: 'POST', body: JSON.stringify(body) });

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?), (?, ?, ?), (?, ?, ?)')
      .bind(owner.id, owner.email, 'Alice', member.id, member.email, 'Bob', viewer.id, viewer.email, 'Carol', reviewer.id, reviewer.email, 'Dave', stranger.id, stranger.email, 'Erin'),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'Acme', 'acme-rv', ?)").bind(WS, owner.id),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('wm_rv1', ?, ?, 'owner', 'internal'), ('wm_rv2', ?, ?, 'member', 'internal'), ('wm_rv3', ?, ?, 'member', 'external'), ('wm_rv4', ?, ?, 'member', 'external')")
      .bind(WS, owner.id, WS, member.id, WS, viewer.id, WS, reviewer.id),
    e.DB.prepare("INSERT INTO artifacts (id, owner_id, name, slug, visibility, workspace_id) VALUES (?, ?, 'Plan', 'rv-plan', 'workspace', ?), (?, ?, 'Secret', 'rv-secret', 'private', ?)")
      .bind(ART, owner.id, WS, OTHER, owner.id, WS),
    e.DB.prepare(`INSERT INTO versions (id, artifact_id, version_no, entrypoint, manifest_json, created_at)
      VALUES ('ver_rv1', ?, 1, 'index.html', '{}', '2026-01-01T00:00:00.000Z'), ('ver_rv2', ?, 2, 'index.html', '{}', '2026-01-02T00:00:00.000Z'),
             ('ver_rvo1', ?, 1, 'index.html', '{}', '2026-01-01T00:00:00.000Z')`).bind(ART, ART, OTHER),
    e.DB.prepare("INSERT INTO deployments (id, artifact_id, version_id, channel, slug) VALUES ('dep_rv', ?, 'ver_rv2', 'production', 'rv-plan'), ('dep_rvo', ?, 'ver_rvo1', 'production', 'rv-secret')").bind(ART, OTHER),
    e.DB.prepare("INSERT INTO grants (id, workspace_id, subject_type, subject_id, resource_type, resource_id, capability, granted_by) VALUES ('gr_rv1', ?, 'external_user', ?, 'artifact', ?, 'view', ?), ('gr_rv2', ?, 'external_user', ?, 'artifact', ?, 'comment', ?)")
      .bind(WS, viewer.id, ART, owner.id, WS, reviewer.id, ART, owner.id),
    e.DB.prepare(`INSERT INTO artifact_comments (id, artifact_id, author_id, author_name, content, created_at, updated_at, version_id)
      VALUES (?, ?, ?, 'Alice', 'Tighten the intro', '2026-01-01T01:00:00.000Z', '2026-01-01T01:00:00.000Z', 'ver_rv1'),
             (?, ?, ?, 'Alice', 'Private note', '2026-01-01T01:00:00.000Z', '2026-01-01T01:00:00.000Z', 'ver_rvo1')`).bind(C1, ART, owner.id, C_OTHER, OTHER, owner.id),
  ]);
});

describe('comment access (canReviewArtifact)', () => {
  it('owner, internal member and comment grant yes; view grant and stranger no', async () => {
    expect(await canReviewArtifact(e, ART, owner)).toBe(true);
    expect(await canReviewArtifact(e, ART, member)).toBe(true);
    expect(await canReviewArtifact(e, ART, reviewer)).toBe(true);
    expect(await canReviewArtifact(e, ART, viewer)).toBe(false);
    expect(await canReviewArtifact(e, ART, stranger)).toBe(false);
    expect(await canReviewArtifact(e, OTHER, member)).toBe(false);
  });
});

describe('resolve / reopen', () => {
  it('denies a viewer without comment access and changes nothing', async () => {
    const r = await setCommentResolved(e, viewer, ART, C1, true);
    expect(r).toMatchObject({ ok: false, status: 403 });
    const row = await e.DB.prepare('SELECT resolved FROM artifact_comments WHERE id = ?').bind(C1).first<{ resolved: number }>();
    expect(row?.resolved).toBe(0);
  });

  it('lets a member (not the author) resolve and reopen', async () => {
    const res = await handleHomeCommentResolveApi(post({ artifactId: ART, commentId: C1, resolved: true }), e, member);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: C1, resolved: 1, resolved_by: member.email });
    expect((await setCommentResolved(e, member, ART, C1, false))).toMatchObject({ ok: true, data: { resolved: 0, resolved_by: null } });
  });

  it('refuses a comment from another artifact, and an artifact the member cannot see', async () => {
    expect(await setCommentResolved(e, member, ART, C_OTHER, true)).toMatchObject({ ok: false, status: 404 });
    expect(await setCommentResolved(e, member, OTHER, C_OTHER, true)).toMatchObject({ ok: false, status: 403 });
    const res = await handleHomeCommentResolveApi(post({ artifactId: ART }), e, member);
    expect(res.status).toBe(400);
  });

  it('data API: a member may resolve in the viewer; a view-only grant may not', async () => {
    const se = { ...e, SESSION_SECRET: 'rv-test-secret' } as typeof e;
    const ctx = { env: se, artifactId: ART, workspaceId: WS, artifact: { id: ART, owner_id: owner.id, workspace_id: WS, visibility: 'workspace' } } as unknown as DataContext;
    const req = async (u: { id: string; email: string }) => new Request('https://x.test', {
      method: 'PATCH',
      headers: { Cookie: `shareout_session=${await createSessionToken(u.id, u.email, se)}` },
      body: JSON.stringify({ resolved: true }),
    });
    expect((await resolveComment(await req(viewer), ctx, C1)).status).toBe(403);
    expect((await resolveComment(await req(member), ctx, C1)).status).toBe(200);
    await setCommentResolved(e, owner, ART, C1, false);
    const assign = new Request('https://x.test', {
      method: 'PATCH',
      headers: { Cookie: `shareout_session=${await createSessionToken(viewer.id, viewer.email, se)}` },
      body: JSON.stringify({ assignee: owner.email }),
    });
    expect((await assignComment(assign, ctx, C1)).status).toBe(403);
  });
});

describe('assign', () => {
  it('denies a viewer, rejects someone not on the artifact, and lands in the assignee’s action items', async () => {
    expect(await setCommentAssignee(e, viewer, ART, C1, member.email)).toMatchObject({ ok: false, status: 403 });
    expect(await setCommentAssignee(e, member, ART, C1, 'nobody@example.com')).toMatchObject({ ok: false, status: 400, code: 'ASSIGNEE_NOT_FOUND' });
    expect(await setCommentAssignee(e, reviewer, ART, C1, member.email)).toMatchObject({ ok: true, data: { assignee_email: member.email } });
    const { items } = await queryActionItems(e, member, WS);
    expect(items.map((i) => i.id)).toContain(C1);
    expect(await setCommentAssignee(e, member, ART, C1, null)).toMatchObject({ ok: true, data: { assignee_email: null } });
    expect(await setCommentAssignee(e, member, ART, C_OTHER, owner.email)).toMatchObject({ ok: false, status: 404 });
  });
});

describe('version anchoring', () => {
  it('stores the live version on a new comment and returns version numbers to the thread', async () => {
    const c = await addArtifactComment(e, member, ART, 'Looks good on the new one', null);
    expect(c).not.toBeNull();
    const row = await e.DB.prepare('SELECT version_id FROM artifact_comments WHERE id = ?').bind(c!.id).first<{ version_id: string }>();
    expect(row?.version_id).toBe('ver_rv2');
    const thread = await queryArtifactComments(e, member, ART);
    expect(thread.find((x) => x.id === C1)).toMatchObject({ version_id: 'ver_rv1', version_no: 1 });
    expect(thread.find((x) => x.id === c!.id)).toMatchObject({ version_no: 2 });
  });
});

describe('approve', () => {
  it('denies a viewer without comment access and a stranger', async () => {
    expect(await setApproval(e, viewer, ART, null, true)).toMatchObject({ ok: false, status: 403 });
    expect(await setApproval(e, stranger, ART, null, true)).toMatchObject({ ok: false, status: 403 });
    expect(await queryReviewState(e, stranger, ART)).toBeNull();
  });

  it('lets a member approve the live version; History shows it with comment counts', async () => {
    const res = await handleHomeApprovalApi(post({ artifactId: ART }), e, member);
    expect(res.status).toBe(200);
    const state = await res.json() as { live_version_no: number; can_review: boolean; approvals: Array<{ version_id: string; email: string }>; my_approvals: string[] };
    expect(state).toMatchObject({ live_version_no: 2, can_review: true, my_approvals: ['ver_rv2'] });
    expect(state.approvals).toEqual([expect.objectContaining({ version_id: 'ver_rv2', email: member.email })]);
    await setApproval(e, member, ART, null, true);
    const n = await e.DB.prepare('SELECT COUNT(*) AS n FROM artifact_approvals WHERE artifact_id = ?').bind(ART).first<{ n: number }>();
    expect(n?.n).toBe(1);

    const hist = await handleGetVersions(new Request('https://x.test'), e, { ...owner, username: null } as AuthUser, ART);
    const body = await hist.json() as { versions: Array<{ id: string; comment_count: number; approvals: Array<{ email: string }> }> };
    const v2 = body.versions.find((v) => v.id === 'ver_rv2')!, v1 = body.versions.find((v) => v.id === 'ver_rv1')!;
    expect(v2.approvals.map((a) => a.email)).toEqual([member.email]);
    expect(v1.approvals).toEqual([]);
    expect(v1.comment_count).toBe(1);
  });

  it('refuses a version from another artifact, and withdraws', async () => {
    expect(await setApproval(e, member, ART, 'ver_rvo1', true)).toMatchObject({ ok: false, status: 404 });
    expect(await setApproval(e, member, OTHER, null, true)).toMatchObject({ ok: false, status: 403 });
    const r = await setApproval(e, member, ART, 'ver_rv2', false);
    expect(r).toMatchObject({ ok: true, data: { approvals: [], my_approvals: [] } });
  });

  it('a comment-grant reviewer can see review state and approve', async () => {
    expect(await queryReviewState(e, reviewer, ART)).toMatchObject({ can_review: true });
    expect(await queryReviewState(e, viewer, ART)).toMatchObject({ can_review: false });
    expect(await setApproval(e, reviewer, ART, null, true)).toMatchObject({ ok: true });
  });
});
