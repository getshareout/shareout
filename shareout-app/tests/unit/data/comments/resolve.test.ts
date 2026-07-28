// @vitest-environment node
/**
 * Comments handler tests: handleComments resolve.
 */
import './mocks';
import './setup';
import { describe, expect, it } from 'vitest';
import { handleComments } from '../../../../src/data/comments';
import { createSessionToken } from '../../../../src/token';
import { ARTIFACT_ID, ROOT_COMMENT, StoredComment, commentsRequest, createCommentsDb, ctxFromDb } from './shared';

describe('handleComments resolve', () => {
  function seedRoot(extra?: Partial<StoredComment>): StoredComment {
    return {
      id: ROOT_COMMENT,
      artifact_id: ARTIFACT_ID,
      context_id: null,
      parent_id: null,
      author_id: null,
      author_name: 'Author',
      content: 'A thread',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      resolved: 0,
      ...extra,
    };
  }

  it('lets the owner resolve a thread and broadcasts comment:resolved', async () => {
    const bundle = createCommentsDb({ comments: [seedRoot()] });
    const ctx = ctxFromDb(bundle);
    const session = await createSessionToken('usr_owner', 'owner@example.com', ctx.env);

    const res = await handleComments(
      commentsRequest(`/${ROOT_COMMENT}/resolve`, {
        method: 'PATCH',
        headers: { Cookie: `shareout_session=${session}` },
        body: JSON.stringify({ resolved: true }),
      }),
      ctx,
      `/${ROOT_COMMENT}/resolve`
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      data: { resolved: true, resolvedBy: 'owner@example.com' },
    });
    expect(bundle._state.comments[0].resolved).toBe(1);
    expect(bundle._state.comments[0].resolved_at).toBeTruthy();
    const broadcastReq = bundle.broadcastFetch.mock.calls[0][0] as Request;
    const broadcastBody = JSON.parse(await broadcastReq.text());
    expect(broadcastBody.type).toBe('comment:resolved');
  });

  it('reopens a resolved thread and clears resolver fields', async () => {
    const bundle = createCommentsDb({
      comments: [seedRoot({ resolved: 1, resolved_by: 'owner@example.com', resolved_at: '2026-01-02T00:00:00.000Z' })],
    });
    const ctx = ctxFromDb(bundle);
    const session = await createSessionToken('usr_owner', 'owner@example.com', ctx.env);

    const res = await handleComments(
      commentsRequest(`/${ROOT_COMMENT}/resolve`, {
        method: 'PATCH',
        headers: { Cookie: `shareout_session=${session}` },
        body: JSON.stringify({ resolved: false }),
      }),
      ctx,
      `/${ROOT_COMMENT}/resolve`
    );

    expect(res.status).toBe(200);
    expect(bundle._state.comments[0].resolved).toBe(0);
    expect(bundle._state.comments[0].resolved_by).toBeNull();
    expect(bundle._state.comments[0].resolved_at).toBeNull();
  });

  it('rejects resolve from a non-author/non-owner', async () => {
    const bundle = createCommentsDb({ comments: [seedRoot({ author_id: 'usr_author' })] });
    const ctx = ctxFromDb(bundle);
    const stranger = await createSessionToken('usr_stranger', 'stranger@example.com', ctx.env);

    const res = await handleComments(
      commentsRequest(`/${ROOT_COMMENT}/resolve`, {
        method: 'PATCH',
        headers: { Cookie: `shareout_session=${stranger}` },
        body: JSON.stringify({ resolved: true }),
      }),
      ctx,
      `/${ROOT_COMMENT}/resolve`
    );

    expect(res.status).toBe(403);
    expect(bundle._state.comments[0].resolved ?? 0).toBe(0);
  });

  it('returns 404 resolving a missing comment', async () => {
    const bundle = createCommentsDb();
    const ctx = ctxFromDb(bundle);
    const session = await createSessionToken('usr_owner', 'owner@example.com', ctx.env);
    const res = await handleComments(
      commentsRequest(`/${ROOT_COMMENT}/resolve`, {
        method: 'PATCH',
        headers: { Cookie: `shareout_session=${session}` },
        body: JSON.stringify({ resolved: true }),
      }),
      ctx,
      `/${ROOT_COMMENT}/resolve`
    );
    expect(res.status).toBe(404);
  });
});

