// @vitest-environment node
/**
 * Comments handler tests: handleComments add.
 */
import './mocks';
import './setup';
import { describe, expect, it } from 'vitest';
import { handleComments } from '../../../../src/data/comments';
import { createSessionToken } from '../../../../src/token';
import { ARTIFACT_ID, CHILD_COMMENT, ROOT_COMMENT, commentsRequest, createCommentsDb, ctxFromDb } from './shared';

describe('handleComments add', () => {
  it('validates body, content length, and identity modes', async () => {
    const bundle = createCommentsDb({ config: { identityMode: 'named' } });
    const ctx = ctxFromDb(bundle);

    const badJson = await handleComments(
      commentsRequest('/', { method: 'POST', body: '{' }),
      ctx,
      '/'
    );
    expect(badJson.status).toBe(400);

    const noContent = await handleComments(
      commentsRequest('/', { method: 'POST', body: JSON.stringify({}) }),
      ctx,
      '/'
    );
    expect(noContent.status).toBe(400);

    const tooLong = await handleComments(
      commentsRequest('/', {
        method: 'POST',
        body: JSON.stringify({ content: 'x'.repeat(10_001), authorName: 'A' }),
      }),
      ctx,
      '/'
    );
    expect(tooLong.status).toBe(400);

    const nameRequired = await handleComments(
      commentsRequest('/', {
        method: 'POST',
        body: JSON.stringify({ content: 'Hi' }),
      }),
      ctx,
      '/'
    );
    expect(nameRequired.status).toBe(400);
    await expect(nameRequired.json()).resolves.toMatchObject({ code: 'NAME_REQUIRED' });

    const named = await handleComments(
      commentsRequest('/', {
        method: 'POST',
        body: JSON.stringify({ content: 'Hi', authorName: '  Pat  ' }),
      }),
      ctx,
      '/'
    );
    expect(named.status).toBe(201);
    await expect(named.json()).resolves.toMatchObject({
      data: { authorName: 'Pat' },
    });
  });

  it('requires authentication when identity mode is authenticated', async () => {
    const bundle = createCommentsDb({ config: { identityMode: 'authenticated' } });
    const ctx = ctxFromDb(bundle);

    const response = await handleComments(
      commentsRequest('/', {
        method: 'POST',
        body: JSON.stringify({ content: 'Needs auth' }),
      }),
      ctx,
      '/'
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it('rejects replies when disabled and validates parent depth', async () => {
    const bundle = createCommentsDb({
      config: { allowReplies: false },
      comments: [{
        id: ROOT_COMMENT,
        artifact_id: ARTIFACT_ID,
        context_id: null,
        parent_id: null,
        author_id: null,
        author_name: 'A',
        content: 'x',
        created_at: 't',
        updated_at: 't',
      }],
    });
    const ctx = ctxFromDb(bundle);

    const repliesOff = await handleComments(
      commentsRequest('/', {
        method: 'POST',
        body: JSON.stringify({ content: 'nope', parentId: ROOT_COMMENT }),
      }),
      ctx,
      '/'
    );
    expect(repliesOff.status).toBe(403);

    const noParent = createCommentsDb({ config: { maxDepth: 3 } });
    const missingParent = await handleComments(
      commentsRequest('/', {
        method: 'POST',
        body: JSON.stringify({ content: 'orphan', parentId: ROOT_COMMENT }),
      }),
      ctxFromDb(noParent),
      '/'
    );
    expect(missingParent.status).toBe(404);

    const deep = createCommentsDb({
      config: { maxDepth: 1 },
      comments: [
        {
          id: ROOT_COMMENT,
          artifact_id: ARTIFACT_ID,
          context_id: null,
          parent_id: null,
          author_id: null,
          author_name: 'A',
          content: 'root',
          created_at: 't1',
          updated_at: 't1',
        },
        {
          id: CHILD_COMMENT,
          artifact_id: ARTIFACT_ID,
          context_id: null,
          parent_id: ROOT_COMMENT,
          author_id: null,
          author_name: 'B',
          content: 'child',
          created_at: 't2',
          updated_at: 't2',
        },
      ],
    });
    const maxDepth = await handleComments(
      commentsRequest('/', {
        method: 'POST',
        body: JSON.stringify({ content: 'too deep', parentId: CHILD_COMMENT }),
      }),
      ctxFromDb(deep),
      '/'
    );
    expect(maxDepth.status).toBe(400);
    await expect(maxDepth.json()).resolves.toMatchObject({ code: 'MAX_DEPTH' });
  });

  it('adds anonymous and authenticated comments and broadcasts', async () => {
    const bundle = createCommentsDb();
    const ctx = ctxFromDb(bundle);

    const anon = await handleComments(
      commentsRequest('/', {
        method: 'POST',
        body: JSON.stringify({ content: 'Hello', authorName: 'Guest' }),
      }),
      ctx,
      '/'
    );
    expect(anon.status).toBe(201);
    expect(bundle._state.comments).toHaveLength(1);
    expect(bundle.broadcastFetch).toHaveBeenCalled();

    const authBundle = createCommentsDb({ config: { identityMode: 'authenticated' } });
    const authCtx = ctxFromDb(authBundle);
    const session = await createSessionToken('usr_commenter', 'user@example.com', authCtx.env);

    const authed = await handleComments(
      commentsRequest('/', {
        method: 'POST',
        headers: { Cookie: `shareout_session=${session}` },
        body: JSON.stringify({ content: 'Signed in' }),
      }),
      authCtx,
      '/'
    );
    expect(authed.status).toBe(201);
    expect(authBundle._state.comments[0].author_id).toBe('usr_commenter');
  });

  it('still persists when broadcast fails', async () => {
    const bundle = createCommentsDb({ broadcastFails: true });
    const response = await handleComments(
      commentsRequest('/', {
        method: 'POST',
        body: JSON.stringify({ content: 'Silent broadcast' }),
      }),
      ctxFromDb(bundle),
      '/'
    );
    expect(response.status).toBe(201);
    expect(bundle._state.comments).toHaveLength(1);
  });

  it('returns invalid config for corrupted identity mode on add', async () => {
    const bundle = createCommentsDb({ config: { identityMode: 'bogus' } });
    const response = await handleComments(
      commentsRequest('/', {
        method: 'POST',
        body: JSON.stringify({ content: 'x' }),
      }),
      ctxFromDb(bundle),
      '/'
    );
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ code: 'INVALID_CONFIG' });
  });
});

