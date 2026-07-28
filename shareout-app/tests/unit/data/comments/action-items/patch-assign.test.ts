// @vitest-environment node
/**
 * Comments handler tests: action items — PATCH /assign.
 */
import '../mocks';
import '../setup';
import { describe, expect, it } from 'vitest';
import { handleComments } from '../../../../../src/data/comments';
import { createSessionToken } from '../../../../../src/token';
import { dispatchActionItemResolved, dispatchCommentNotify } from '../mocks';
import { ARTIFACT_ID, ROOT_COMMENT, StoredComment, commentsRequest, createCommentsDb, ctxFromDb } from '../shared';

describe('action items — PATCH /assign', () => {
  function seed(extra?: Partial<StoredComment>) {
    return createCommentsDb({
      comments: [{
        id: ROOT_COMMENT, artifact_id: ARTIFACT_ID, context_id: null, parent_id: null,
        author_id: 'usr_author', author_name: 'Author', content: 'A task',
        created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
        ...extra,
      }],
      collaborators: [{ email: 'assignee@example.com', role: 'editor' }],
      users: [
        { id: 'usr_assignee', email: 'assignee@example.com', name: 'Assignee' },
        { id: 'usr_author', email: 'author@example.com', name: 'Author' },
      ],
    });
  }
  const ASSIGN = `/${ROOT_COMMENT}/assign`;

  it('sets, changes, and clears the assignee', async () => {
    const bundle = seed();
    const ctx = ctxFromDb(bundle);
    const session = await createSessionToken('usr_author', 'author@example.com', ctx.env);
    const headers = { Cookie: `shareout_session=${session}` };

    const set = await handleComments(
      commentsRequest(ASSIGN, { method: 'PATCH', headers, body: JSON.stringify({ assignee: 'assignee@example.com', dueAt: '2026-09-01T00:00:00.000Z' }) }),
      ctx, ASSIGN
    );
    expect(set.status).toBe(200);
    await expect(set.json()).resolves.toMatchObject({
      data: { assigneeEmail: 'assignee@example.com', assigneeUserId: 'usr_assignee', dueAt: '2026-09-01T00:00:00.000Z' },
    });
    expect(dispatchCommentNotify).toHaveBeenCalledTimes(1);

    const clear = await handleComments(
      commentsRequest(ASSIGN, { method: 'PATCH', headers, body: JSON.stringify({ assignee: null }) }),
      ctx, ASSIGN
    );
    expect(clear.status).toBe(200);
    await expect(clear.json()).resolves.toMatchObject({
      data: { assigneeEmail: null, assigneeUserId: null, dueAt: null },
    });
    expect(bundle._state.comments[0].assignee_email).toBeNull();
    expect(bundle._state.comments[0].due_at).toBeNull();
  });

  it('rejects a non-author/owner/assignee', async () => {
    const bundle = seed();
    const ctx = ctxFromDb(bundle);
    const stranger = await createSessionToken('usr_stranger', 'stranger@example.com', ctx.env);
    const res = await handleComments(
      commentsRequest(ASSIGN, { method: 'PATCH', headers: { Cookie: `shareout_session=${stranger}` }, body: JSON.stringify({ assignee: 'assignee@example.com' }) }),
      ctx, ASSIGN
    );
    expect(res.status).toBe(403);
  });

  it('rejects an assignee outside the people set', async () => {
    const bundle = seed();
    const ctx = ctxFromDb(bundle);
    const session = await createSessionToken('usr_author', 'author@example.com', ctx.env);
    const res = await handleComments(
      commentsRequest(ASSIGN, { method: 'PATCH', headers: { Cookie: `shareout_session=${session}` }, body: JSON.stringify({ assignee: 'nope@evil.com' }) }),
      ctx, ASSIGN
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: 'ASSIGNEE_NOT_FOUND' });
  });

  it('broadcasts comment:updated with assignee fields', async () => {
    const bundle = seed();
    const ctx = ctxFromDb(bundle);
    const session = await createSessionToken('usr_author', 'author@example.com', ctx.env);
    await handleComments(
      commentsRequest(ASSIGN, { method: 'PATCH', headers: { Cookie: `shareout_session=${session}` }, body: JSON.stringify({ assignee: 'assignee@example.com' }) }),
      ctx, ASSIGN
    );
    const broadcastReq = bundle.broadcastFetch.mock.calls[0][0] as Request;
    const payload = JSON.parse(await broadcastReq.text());
    expect(payload.type).toBe('comment:updated');
    expect(payload.comment.assigneeEmail).toBe('assignee@example.com');
  });

  it('lets the current assignee re-assign', async () => {
    const bundle = seed({ assignee_user_id: 'usr_assignee', assignee_email: 'assignee@example.com' });
    const ctx = ctxFromDb(bundle);
    const session = await createSessionToken('usr_assignee', 'assignee@example.com', ctx.env);
    const res = await handleComments(
      commentsRequest(ASSIGN, { method: 'PATCH', headers: { Cookie: `shareout_session=${session}` }, body: JSON.stringify({ assignee: null }) }),
      ctx, ASSIGN
    );
    expect(res.status).toBe(200);
  });
});

