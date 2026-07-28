// @vitest-environment node
/**
 * Comments handler tests: handleComments resolved filter.
 */
import './mocks';
import './setup';
import { describe, expect, it } from 'vitest';
import { handleComments } from '../../../../src/data/comments';
import { ARTIFACT_ID, commentsRequest, createCommentsDb, ctxFromDb } from './shared';

describe('handleComments resolved filter', () => {
  it('partitions comments by resolved state', async () => {
    const base = {
      artifact_id: ARTIFACT_ID, context_id: null, parent_id: null,
      author_id: null, author_name: 'A', created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    };
    const bundle = createCommentsDb({
      comments: [
        { ...base, id: 'cmt_000000000000000000000010', content: 'open', resolved: 0 },
        { ...base, id: 'cmt_000000000000000000000011', content: 'done', resolved: 1 },
      ],
    });
    const ctx = ctxFromDb(bundle);

    const open = await handleComments(commentsRequest('/?parentId=null&resolved=false'), ctx, '/');
    await expect(open.json()).resolves.toMatchObject({ data: { count: 1 } });

    const resolved = await handleComments(commentsRequest('/?parentId=null&resolved=true'), ctx, '/');
    await expect(resolved.json()).resolves.toMatchObject({ data: { count: 1 } });

    const all = await handleComments(commentsRequest('/?parentId=null'), ctx, '/');
    await expect(all.json()).resolves.toMatchObject({ data: { count: 2 } });
  });
});

