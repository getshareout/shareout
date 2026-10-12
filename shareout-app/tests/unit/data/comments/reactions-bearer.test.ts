// @vitest-environment node
/**
 * Reactions (and comment identity) accept a Bearer API token, not only the session cookie.
 */
import './mocks';
import './setup';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../src/api-auth', async (orig) => ({
  ...(await orig<typeof import('../../../../src/api-auth')>()),
  validateToken: vi.fn(async (req: Request) =>
    req.headers.get('Authorization') === 'Bearer so_test' ? { id: 'usr_tok', email: 't@example.com', username: null } : null),
}));

import { handleComments } from '../../../../src/data/comments';
import { ARTIFACT_ID, ROOT_COMMENT, commentsRequest, createCommentsDb, ctxFromDb } from './shared';

describe('reactions with a Bearer token', () => {
  const REACT_PATH = `/${ROOT_COMMENT}/reactions`;
  const db = () => createCommentsDb({
    comments: [{
      id: ROOT_COMMENT, artifact_id: ARTIFACT_ID, context_id: null, parent_id: null,
      author_id: 'usr_owner', author_name: 'Owner', content: 'hi',
      created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
    }],
  });

  it('reacts as the token user', async () => {
    const res = await handleComments(
      commentsRequest(REACT_PATH, { method: 'POST', headers: { Authorization: 'Bearer so_test' }, body: JSON.stringify({ emoji: '👍' }) }),
      ctxFromDb(db()), REACT_PATH,
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ data: { reacted: true, reactions: { '👍': { count: 1, mine: true } } } });
  });

  it('still 401s an unknown token', async () => {
    const res = await handleComments(
      commentsRequest(REACT_PATH, { method: 'POST', headers: { Authorization: 'Bearer so_bad' }, body: JSON.stringify({ emoji: '👍' }) }),
      ctxFromDb(db()), REACT_PATH,
    );
    expect(res.status).toBe(401);
  });
});

describe('action items, _people and the comments socket with a Bearer token', () => {
  const auth = { Authorization: 'Bearer so_test' };
  const db = () => createCommentsDb({
    comments: [{
      id: ROOT_COMMENT, artifact_id: ARTIFACT_ID, context_id: null, parent_id: null,
      author_id: 'usr_tok', author_name: 'Tok', content: 'hi',
      created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-01T00:00:00Z',
    }],
  });

  it('authenticates assign and _people with the token', async () => {
    const assign = await handleComments(
      commentsRequest(`/${ROOT_COMMENT}/assign`, { method: 'PATCH', headers: auth, body: JSON.stringify({ assignee: null }) }),
      ctxFromDb(db()), `/${ROOT_COMMENT}/assign`,
    );
    expect(assign.status).not.toBe(401);
    const people = await handleComments(commentsRequest('/_people', { headers: auth }), ctxFromDb(db()), '/_people');
    expect(people.status).not.toBe(401);
  });

  it('opens the comments socket on a private artifact with the token', async () => {
    const bundle = db();
    const fetchMock = vi.fn().mockResolvedValue(new Response('upgraded', { status: 200 }));
    bundle.commentsDo.get.mockReturnValue({ fetch: fetchMock });
    const req = new Request(`https://example.com/v1/data/${ARTIFACT_ID}/comments/ws`, { headers: { ...auth, Upgrade: 'websocket' } });
    const res = await handleComments(req, ctxFromDb(bundle, { visibility: 'private' }), '/ws');
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
  });
});
