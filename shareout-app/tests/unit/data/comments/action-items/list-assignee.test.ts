// @vitest-environment node
/**
 * Comments handler tests: action items — list ?assignee=me.
 */
import '../mocks';
import '../setup';
import { describe, expect, it } from 'vitest';
import { handleComments } from '../../../../../src/data/comments';
import { createSessionToken } from '../../../../../src/token';
import { ARTIFACT_ID, commentsRequest, createCommentsDb, ctxFromDb } from '../shared';

describe('action items — list ?assignee=me', () => {
  function seed() {
    const base = {
      artifact_id: ARTIFACT_ID, context_id: null, parent_id: null, author_id: 'usr_author',
      author_name: 'A', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
    };
    return createCommentsDb({
      comments: [
        { ...base, id: 'cmt_000000000000000000000021', content: 'mine-by-id', assignee_user_id: 'usr_me', assignee_email: 'me@example.com' },
        { ...base, id: 'cmt_000000000000000000000022', content: 'mine-by-email', assignee_user_id: null, assignee_email: 'me@example.com' },
        { ...base, id: 'cmt_000000000000000000000023', content: 'someone-else', assignee_user_id: 'usr_x', assignee_email: 'x@example.com' },
        { ...base, id: 'cmt_000000000000000000000024', content: 'unassigned' },
      ],
    });
  }

  it('filters to the viewer by user id and email fallback', async () => {
    const ctx = ctxFromDb(seed());
    const session = await createSessionToken('usr_me', 'me@example.com', ctx.env);
    const res = await handleComments(
      commentsRequest('/?assignee=me', { headers: { Cookie: `shareout_session=${session}` } }),
      ctx, '/'
    );
    await expect(res.json()).resolves.toMatchObject({ data: { count: 2 } });
  });

  it('returns empty for anonymous ?assignee=me', async () => {
    const res = await handleComments(commentsRequest('/?assignee=me'), ctxFromDb(seed()), '/');
    await expect(res.json()).resolves.toMatchObject({ data: { count: 0 } });
  });

  it('filters by an explicit assignee email', async () => {
    const res = await handleComments(commentsRequest('/?assignee=x@example.com'), ctxFromDb(seed()), '/');
    await expect(res.json()).resolves.toMatchObject({ data: { count: 1 } });
  });
});

