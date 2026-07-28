// @vitest-environment node
/**
 * Comments handler tests: handleComments edit and delete.
 */
import './mocks';
import './setup';
import { describe, expect, it } from 'vitest';
import { handleComments } from '../../../../src/data/comments';
import { createSessionToken } from '../../../../src/token';
import { ARTIFACT_ID, ROOT_COMMENT, StoredComment, commentsRequest, createCommentsDb, ctxFromDb } from './shared';

describe('handleComments edit and delete', () => {
  const authorComment: StoredComment = {
    id: ROOT_COMMENT,
    artifact_id: ARTIFACT_ID,
    context_id: null,
    parent_id: null,
    author_id: 'usr_author',
    author_name: 'Author',
    content: 'Original',
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
  };

  it('rejects invalid JSON and missing content on edit', async () => {
    const bundle = createCommentsDb({ comments: [authorComment] });
    const ctx = ctxFromDb(bundle);

    const badJson = await handleComments(
      commentsRequest(`/${ROOT_COMMENT}`, { method: 'PATCH', body: '{' }),
      ctx,
      `/${ROOT_COMMENT}`
    );
    expect(badJson.status).toBe(400);

    const noContent = await handleComments(
      commentsRequest(`/${ROOT_COMMENT}`, {
        method: 'PATCH',
        body: JSON.stringify({}),
      }),
      ctx,
      `/${ROOT_COMMENT}`
    );
    expect(noContent.status).toBe(400);
  });

  it('forbids edit and delete for non-owner non-author', async () => {
    const bundle = createCommentsDb({ comments: [authorComment] });
    const ctx = ctxFromDb(bundle);
    const stranger = await createSessionToken('usr_other', 'other@example.com', ctx.env);

    const patch = await handleComments(
      commentsRequest(`/${ROOT_COMMENT}`, {
        method: 'PATCH',
        headers: { Cookie: `shareout_session=${stranger}` },
        body: JSON.stringify({ content: 'Hacked' }),
      }),
      ctx,
      `/${ROOT_COMMENT}`
    );
    expect(patch.status).toBe(403);

    const del = await handleComments(
      commentsRequest(`/${ROOT_COMMENT}`, {
        method: 'DELETE',
        headers: { Cookie: `shareout_session=${stranger}` },
      }),
      ctx,
      `/${ROOT_COMMENT}`
    );
    expect(del.status).toBe(403);
  });

  it('allows author to edit and owner to delete', async () => {
    const bundle = createCommentsDb({ comments: [authorComment] });
    const ctx = ctxFromDb(bundle);
    const authorSession = await createSessionToken('usr_author', 'author@example.com', ctx.env);

    const patch = await handleComments(
      commentsRequest(`/${ROOT_COMMENT}`, {
        method: 'PATCH',
        headers: { Cookie: `shareout_session=${authorSession}` },
        body: JSON.stringify({ content: 'Updated by author' }),
      }),
      ctx,
      `/${ROOT_COMMENT}`
    );
    expect(patch.status).toBe(200);
    await expect(patch.json()).resolves.toMatchObject({
      data: { content: 'Updated by author' },
    });

    const ownerSession = await createSessionToken('usr_owner', 'owner@example.com', ctx.env);
    const del = await handleComments(
      commentsRequest(`/${ROOT_COMMENT}`, {
        method: 'DELETE',
        headers: { Cookie: `shareout_session=${ownerSession}` },
      }),
      ctx,
      `/${ROOT_COMMENT}`
    );
    expect(del.status).toBe(200);
    await expect(del.json()).resolves.toMatchObject({ data: { deleted: true } });
    expect(bundle._state.comments).toHaveLength(0);
  });

  it('returns not found for missing comments on edit and delete', async () => {
    const bundle = createCommentsDb();
    const ctx = ctxFromDb(bundle);
    const ownerSession = await createSessionToken('usr_owner', 'owner@example.com', ctx.env);

    const patch = await handleComments(
      commentsRequest('/cmt_000000000000000000000099', {
        method: 'PATCH',
        headers: { Cookie: `shareout_session=${ownerSession}` },
        body: JSON.stringify({ content: 'x' }),
      }),
      ctx,
      '/cmt_000000000000000000000099'
    );
    expect(patch.status).toBe(404);

    const del = await handleComments(
      commentsRequest('/cmt_000000000000000000000099', {
        method: 'DELETE',
        headers: { Cookie: `shareout_session=${ownerSession}` },
      }),
      ctx,
      '/cmt_000000000000000000000099'
    );
    expect(del.status).toBe(404);
  });

  it('rejects edit when content exceeds max length', async () => {
    const bundle = createCommentsDb({ comments: [authorComment] });
    const ctx = ctxFromDb(bundle);
    const ownerSession = await createSessionToken('usr_owner', 'owner@example.com', ctx.env);

    const response = await handleComments(
      commentsRequest(`/${ROOT_COMMENT}`, {
        method: 'PATCH',
        headers: { Cookie: `shareout_session=${ownerSession}` },
        body: JSON.stringify({ content: 'x'.repeat(10_001) }),
      }),
      ctx,
      `/${ROOT_COMMENT}`
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'CONTENT_TOO_LONG' });
  });
});

