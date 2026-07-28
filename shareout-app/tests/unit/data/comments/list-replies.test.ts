// @vitest-environment node
/**
 * Comments handler tests: handleComments list and replies.
 */
import './mocks';
import './setup';
import { describe, expect, it } from 'vitest';
import { handleComments } from '../../../../src/data/comments';
import { ARTIFACT_ID, CHILD_COMMENT, ROOT_COMMENT, StoredComment, commentsRequest, createCommentsDb, ctxFromDb } from './shared';

describe('handleComments list and replies', () => {
  const seedComments: StoredComment[] = [
    {
      id: ROOT_COMMENT,
      artifact_id: ARTIFACT_ID,
      context_id: 'ctx-a',
      parent_id: null,
      author_id: null,
      author_name: 'Alice',
      content: 'Root',
      created_at: '2024-01-02T00:00:00.000Z',
      updated_at: '2024-01-02T00:00:00.000Z',
    },
    {
      id: CHILD_COMMENT,
      artifact_id: ARTIFACT_ID,
      context_id: 'ctx-a',
      parent_id: ROOT_COMMENT,
      author_id: null,
      author_name: 'Bob',
      content: 'Reply',
      created_at: '2024-01-01T00:00:00.000Z',
      updated_at: '2024-01-01T00:00:00.000Z',
    },
  ];

  it('lists comments with context, parent, limit, and skip filters', async () => {
    const bundle = createCommentsDb({ comments: seedComments });
    const ctx = ctxFromDb(bundle);

    const all = await handleComments(commentsRequest('/'), ctx, '/');
    expect(all.status).toBe(200);
    await expect(all.json()).resolves.toMatchObject({
      success: true,
      data: { count: 2 },
    });

    const byContext = await handleComments(
      commentsRequest('/?contextId=ctx-a'),
      ctx,
      '/'
    );
    await expect(byContext.json()).resolves.toMatchObject({ data: { count: 2 } });

    const topLevel = await handleComments(
      commentsRequest('/?parentId=null'),
      ctx,
      '/'
    );
    await expect(topLevel.json()).resolves.toMatchObject({ data: { count: 1 } });

    const byParent = await handleComments(
      commentsRequest(`/?parentId=${ROOT_COMMENT}`),
      ctx,
      '/'
    );
    await expect(byParent.json()).resolves.toMatchObject({ data: { count: 1 } });

    const paged = await handleComments(
      commentsRequest('/?limit=1&skip=1'),
      ctx,
      '/'
    );
    const pagedBody = await paged.json() as { data: { comments: { id: string }[] } };
    expect(pagedBody.data.comments).toHaveLength(1);
  });

  it('gets a single comment and its replies', async () => {
    const bundle = createCommentsDb({ comments: seedComments });
    const ctx = ctxFromDb(bundle);

    const get = await handleComments(
      commentsRequest(`/${ROOT_COMMENT}`),
      ctx,
      `/${ROOT_COMMENT}`
    );
    expect(get.status).toBe(200);
    await expect(get.json()).resolves.toMatchObject({
      data: { id: ROOT_COMMENT, content: 'Root' },
    });

    const replies = await handleComments(
      commentsRequest(`/${ROOT_COMMENT}/replies`),
      ctx,
      `/${ROOT_COMMENT}/replies`
    );
    expect(replies.status).toBe(200);
    await expect(replies.json()).resolves.toMatchObject({
      data: { count: 1, replies: [{ id: CHILD_COMMENT }] },
    });

    const missing = await handleComments(
      commentsRequest('/cmt_000000000000000000000099'),
      ctx,
      '/cmt_000000000000000000000099'
    );
    expect(missing.status).toBe(404);
  });
});

