// @vitest-environment node
/**
 * Comments handler tests: action items — resolve by assignee + notify.
 */
import '../mocks';
import '../setup';
import { describe, expect, it } from 'vitest';
import { handleComments } from '../../../../../src/data/comments';
import { createSessionToken } from '../../../../../src/token';
import { dispatchActionItemResolved, dispatchCommentNotify } from '../mocks';
import { ARTIFACT_ID, ROOT_COMMENT, commentsRequest, createCommentsDb, ctxFromDb } from '../shared';

describe('action items — resolve by assignee + notify', () => {
  function seed() {
    return createCommentsDb({
      comments: [{
        id: ROOT_COMMENT, artifact_id: ARTIFACT_ID, context_id: null, parent_id: null,
        author_id: 'usr_author', author_name: 'Author', content: 'A task',
        created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
        resolved: 0, assignee_user_id: 'usr_assignee', assignee_email: 'assignee@example.com',
      }],
      users: [
        { id: 'usr_assignee', email: 'assignee@example.com', name: 'Assignee' },
        { id: 'usr_author', email: 'author@example.com', name: 'Author' },
      ],
    });
  }
  const RESOLVE = `/${ROOT_COMMENT}/resolve`;

  it('lets the assignee resolve and notifies the author', async () => {
    const bundle = seed();
    const ctx = ctxFromDb(bundle);
    const session = await createSessionToken('usr_assignee', 'assignee@example.com', ctx.env);
    const res = await handleComments(
      commentsRequest(RESOLVE, { method: 'PATCH', headers: { Cookie: `shareout_session=${session}` }, body: JSON.stringify({ resolved: true }) }),
      ctx, RESOLVE
    );
    expect(res.status).toBe(200);
    expect(bundle._state.comments[0].resolved).toBe(1);
    expect(dispatchActionItemResolved).toHaveBeenCalledTimes(1);
    const [, requester] = dispatchActionItemResolved.mock.calls[0];
    expect(requester).toMatchObject({ userId: 'usr_author', email: 'author@example.com' });
  });

  it('still forbids a random user from resolving', async () => {
    const bundle = seed();
    const ctx = ctxFromDb(bundle);
    const stranger = await createSessionToken('usr_stranger', 'stranger@example.com', ctx.env);
    const res = await handleComments(
      commentsRequest(RESOLVE, { method: 'PATCH', headers: { Cookie: `shareout_session=${stranger}` }, body: JSON.stringify({ resolved: true }) }),
      ctx, RESOLVE
    );
    expect(res.status).toBe(403);
    expect(dispatchActionItemResolved).not.toHaveBeenCalled();
  });

  it('does not notify when the author resolves their own action item', async () => {
    const bundle = seed();
    const ctx = ctxFromDb(bundle);
    const session = await createSessionToken('usr_author', 'author@example.com', ctx.env);
    const res = await handleComments(
      commentsRequest(RESOLVE, { method: 'PATCH', headers: { Cookie: `shareout_session=${session}` }, body: JSON.stringify({ resolved: true }) }),
      ctx, RESOLVE
    );
    expect(res.status).toBe(200);
    expect(dispatchActionItemResolved).not.toHaveBeenCalled();
  });
});

