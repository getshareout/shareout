// @vitest-environment node
/**
 * Comments handler tests: handleComments unread.
 */
import './mocks';
import './setup';
import { describe, expect, it } from 'vitest';
import { handleComments } from '../../../../src/data/comments';
import { createSessionToken } from '../../../../src/token';
import { ARTIFACT_ID, CHILD_COMMENT, ROOT_COMMENT, commentsRequest, createCommentsDb, ctxFromDb } from './shared';

describe('handleComments unread', () => {
  function seededTwoAuthors() {
    return createCommentsDb({
      comments: [
        { id: ROOT_COMMENT, artifact_id: ARTIFACT_ID, context_id: null, parent_id: null,
          author_id: 'usr_other', author_name: 'Other', content: 'a',
          created_at: '2024-01-02T00:00:00Z', updated_at: '2024-01-02T00:00:00Z' },
        { id: CHILD_COMMENT, artifact_id: ARTIFACT_ID, context_id: null, parent_id: null,
          author_id: 'usr_me', author_name: 'Me', content: 'b',
          created_at: '2024-01-03T00:00:00Z', updated_at: '2024-01-03T00:00:00Z' },
      ],
    });
  }

  it('returns 0 unread for anonymous viewers', async () => {
    const res = await handleComments(commentsRequest('/_unread'), ctxFromDb(seededTwoAuthors()), '/_unread');
    await expect(res.json()).resolves.toMatchObject({ data: { count: 0 } });
  });

  it('counts comments by others and excludes the viewer own', async () => {
    const ctx = ctxFromDb(seededTwoAuthors());
    const session = await createSessionToken('usr_me', 'me@example.com', ctx.env);
    const res = await handleComments(
      commentsRequest('/_unread', { headers: { Cookie: `shareout_session=${session}` } }),
      ctx, '/_unread'
    );
    await expect(res.json()).resolves.toMatchObject({ data: { count: 1 } });
  });

  it('drops unread to 0 after marking read', async () => {
    const ctx = ctxFromDb(seededTwoAuthors());
    const session = await createSessionToken('usr_me', 'me@example.com', ctx.env);
    const headers = { Cookie: `shareout_session=${session}` };
    await handleComments(commentsRequest('/_read', { method: 'POST', headers }), ctx, '/_read');
    const res = await handleComments(commentsRequest('/_unread', { headers }), ctx, '/_unread');
    await expect(res.json()).resolves.toMatchObject({ data: { count: 0 } });
  });
});

