// @vitest-environment node
/**
 * Comments handler tests: handleComments disabled and routing.
 */
import './mocks';
import './setup';
import { describe, expect, it } from 'vitest';
import { handleComments } from '../../../../src/data/comments';
import { ARTIFACT_ID, ROOT_COMMENT, commentsRequest, createCommentsDb, ctxFromDb } from './shared';

describe('handleComments disabled and routing', () => {
  it('returns 403 when comments are disabled', async () => {
    const bundle = createCommentsDb({ config: { enabled: false } });
    const response = await handleComments(
      commentsRequest('/'),
      ctxFromDb(bundle),
      '/'
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'COMMENTS_DISABLED' });
  });

  it('rejects invalid comment ids and unsupported root methods', async () => {
    const bundle = createCommentsDb();
    const ctx = ctxFromDb(bundle);

    const invalid = await handleComments(
      commentsRequest('/bad-id'),
      ctx,
      '/bad-id'
    );
    expect(invalid.status).toBe(400);

    const method = await handleComments(
      commentsRequest('/', { method: 'DELETE' }),
      ctx,
      '/'
    );
    expect(method.status).toBe(405);
  });

  it('returns NOT_FOUND for unknown sub-routes on comment id', async () => {
    const bundle = createCommentsDb({
      comments: [{
        id: ROOT_COMMENT,
        artifact_id: ARTIFACT_ID,
        context_id: null,
        parent_id: null,
        author_id: null,
        author_name: 'Anon',
        content: 'Hi',
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
      }],
    });
    const ctx = ctxFromDb(bundle);

    const method = await handleComments(
      commentsRequest(`/${ROOT_COMMENT}`, { method: 'POST' }),
      ctx,
      `/${ROOT_COMMENT}`
    );
    expect(method.status).toBe(405);
  });
});

