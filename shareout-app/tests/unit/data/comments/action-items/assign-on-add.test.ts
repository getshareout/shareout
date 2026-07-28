// @vitest-environment node
/**
 * Comments handler tests: action items — assign on add.
 */
import '../mocks';
import '../setup';
import { describe, expect, it } from 'vitest';
import { handleComments } from '../../../../../src/data/comments';
import { createSessionToken } from '../../../../../src/token';
import { dispatchActionItemResolved, dispatchCommentNotify } from '../mocks';
import { commentsRequest, createCommentsDb, ctxFromDb } from '../shared';

describe('action items — assign on add', () => {
  function withPeople() {
    return createCommentsDb({
      collaborators: [
        { email: 'assignee@example.com', role: 'editor' },
        { email: 'external@example.com', role: 'viewer' },
      ],
      users: [{ id: 'usr_assignee', email: 'assignee@example.com', name: 'Assignee' }],
    });
  }

  it('stores assignee email + resolved user id for an authenticated commenter', async () => {
    const bundle = withPeople();
    const ctx = ctxFromDb(bundle);
    const session = await createSessionToken('usr_owner', 'owner@example.com', ctx.env);

    const res = await handleComments(
      commentsRequest('/', {
        method: 'POST',
        headers: { Cookie: `shareout_session=${session}` },
        body: JSON.stringify({ content: 'Do this', assignee: 'assignee@example.com', dueAt: '2026-08-01T00:00:00.000Z' }),
      }),
      ctx, '/'
    );
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({
      data: { assigneeEmail: 'assignee@example.com', assigneeUserId: 'usr_assignee', dueAt: '2026-08-01T00:00:00.000Z' },
    });
    expect(bundle._state.comments[0].assignee_user_id).toBe('usr_assignee');
    expect(dispatchCommentNotify).toHaveBeenCalled();
  });

  it('stores external collaborator with null user id', async () => {
    const bundle = withPeople();
    const ctx = ctxFromDb(bundle);
    const session = await createSessionToken('usr_owner', 'owner@example.com', ctx.env);
    const res = await handleComments(
      commentsRequest('/', {
        method: 'POST',
        headers: { Cookie: `shareout_session=${session}` },
        body: JSON.stringify({ content: 'x', assignee: 'external@example.com' }),
      }),
      ctx, '/'
    );
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({
      data: { assigneeEmail: 'external@example.com', assigneeUserId: null },
    });
  });

  it('rejects an anonymous commenter trying to assign', async () => {
    const bundle = withPeople();
    const res = await handleComments(
      commentsRequest('/', {
        method: 'POST',
        body: JSON.stringify({ content: 'x', authorName: 'Guest', assignee: 'assignee@example.com' }),
      }),
      ctxFromDb(bundle), '/'
    );
    expect(res.status).toBe(401);
    expect(bundle._state.comments).toHaveLength(0);
  });

  it('rejects an assignee outside the people set', async () => {
    const bundle = withPeople();
    const ctx = ctxFromDb(bundle);
    const session = await createSessionToken('usr_owner', 'owner@example.com', ctx.env);
    const res = await handleComments(
      commentsRequest('/', {
        method: 'POST',
        headers: { Cookie: `shareout_session=${session}` },
        body: JSON.stringify({ content: 'x', assignee: 'stranger@evil.com' }),
      }),
      ctx, '/'
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: 'ASSIGNEE_NOT_FOUND' });
  });

  it('rejects an unparseable dueAt', async () => {
    const bundle = withPeople();
    const ctx = ctxFromDb(bundle);
    const session = await createSessionToken('usr_owner', 'owner@example.com', ctx.env);
    const res = await handleComments(
      commentsRequest('/', {
        method: 'POST',
        headers: { Cookie: `shareout_session=${session}` },
        body: JSON.stringify({ content: 'x', dueAt: 'not-a-date' }),
      }),
      ctx, '/'
    );
    expect(res.status).toBe(400);
  });
});

