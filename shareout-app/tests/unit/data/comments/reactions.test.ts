// @vitest-environment node
/**
 * Comments handler tests: handleComments reactions.
 */
import './mocks';
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { handleComments } from '../../../../src/data/comments';
import { createSessionToken } from '../../../../src/token';
import { ARTIFACT_ID, CHILD_COMMENT, ROOT_COMMENT, commentsRequest, createCommentsDb, ctxFromDb } from './shared';

describe('handleComments reactions', () => {
  const REACT_PATH = `/${ROOT_COMMENT}/reactions`;
  function seeded() {
    return createCommentsDb({
      comments: [{
        id: ROOT_COMMENT, artifact_id: ARTIFACT_ID, context_id: null, parent_id: null,
        author_id: 'usr_owner', author_name: 'Owner', content: 'hi',
        created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
      }],
    });
  }

  it('requires a session to react', async () => {
    const res = await handleComments(
      commentsRequest(REACT_PATH, { method: 'POST', body: JSON.stringify({ emoji: '👍' }) }),
      ctxFromDb(seeded()),
      REACT_PATH
    );
    expect(res.status).toBe(401);
  });

  it('rejects an empty or oversized emoji', async () => {
    const ctx = ctxFromDb(seeded());
    const session = await createSessionToken('usr_a', 'a@example.com', ctx.env);
    const res = await handleComments(
      commentsRequest(REACT_PATH, { method: 'POST', headers: { Cookie: `shareout_session=${session}` }, body: JSON.stringify({ emoji: '' }) }),
      ctx,
      REACT_PATH
    );
    expect(res.status).toBe(400);
  });

  it('toggles a reaction on then off and reports the summary', async () => {
    const ctx = ctxFromDb(seeded());
    const session = await createSessionToken('usr_a', 'a@example.com', ctx.env);
    const headers = { Cookie: `shareout_session=${session}` };

    const on = await handleComments(
      commentsRequest(REACT_PATH, { method: 'POST', headers, body: JSON.stringify({ emoji: '👍' }) }),
      ctx, REACT_PATH
    );
    expect(on.status).toBe(200);
    await expect(on.json()).resolves.toMatchObject({
      data: { reacted: true, emoji: '👍', reactions: { '👍': { count: 1, mine: true } } },
    });

    const off = await handleComments(
      commentsRequest(REACT_PATH, { method: 'POST', headers, body: JSON.stringify({ emoji: '👍' }) }),
      ctx, REACT_PATH
    );
    await expect(off.json()).resolves.toMatchObject({ data: { reacted: false, reactions: {} } });
  });

  it('404s reacting to a missing comment', async () => {
    const ctx = ctxFromDb(seeded());
    const session = await createSessionToken('usr_a', 'a@example.com', ctx.env);
    const path = `/${CHILD_COMMENT}/reactions`;
    const res = await handleComments(
      commentsRequest(path, { method: 'POST', headers: { Cookie: `shareout_session=${session}` }, body: JSON.stringify({ emoji: '👍' }) }),
      ctx, path
    );
    expect(res.status).toBe(404);
  });

  it('attaches reaction summaries when listing comments', async () => {
    const ctx = ctxFromDb(seeded());
    const sessionA = await createSessionToken('usr_a', 'a@example.com', ctx.env);
    const sessionB = await createSessionToken('usr_b', 'b@example.com', ctx.env);
    await handleComments(commentsRequest(REACT_PATH, { method: 'POST', headers: { Cookie: `shareout_session=${sessionA}` }, body: JSON.stringify({ emoji: '👍' }) }), ctx, REACT_PATH);
    await handleComments(commentsRequest(REACT_PATH, { method: 'POST', headers: { Cookie: `shareout_session=${sessionB}` }, body: JSON.stringify({ emoji: '👍' }) }), ctx, REACT_PATH);

    const list = await handleComments(
      commentsRequest('?parentId=null&resolved=false', { headers: { Cookie: `shareout_session=${sessionA}` } }),
      ctx, ''
    );
    const body = await list.json() as { data: { comments: Array<{ id: string; reactions: Record<string, { count: number; mine: boolean }> }> } };
    expect(body.data.comments[0].reactions['👍']).toEqual({ count: 2, mine: true });
  });
});

