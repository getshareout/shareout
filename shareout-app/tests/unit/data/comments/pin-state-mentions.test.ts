// @vitest-environment node
/**
 * Comments handler tests: handleComments add with pin + state + mentions.
 */
import './mocks';
import './setup';
import { describe, expect, it } from 'vitest';
import { handleComments } from '../../../../src/data/comments';
import { commentsRequest, createCommentsDb, ctxFromDb } from './shared';

describe('handleComments add with pin + state + mentions', () => {
  it('persists and returns position, state, and mentions', async () => {
    const bundle = createCommentsDb();
    const ctx = ctxFromDb(bundle);
    const res = await handleComments(
      commentsRequest('/', {
        method: 'POST',
        body: JSON.stringify({
          content: 'Pinned here',
          authorName: 'Pat',
          position: { selector: '#main', relX: 0.5, relY: 0.3 },
          state: { filter: 'q2' },
          mentions: ['a@example.com', 'b@example.com'],
        }),
      }),
      ctx,
      '/'
    );

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({
      data: {
        position: { selector: '#main' },
        state: { filter: 'q2' },
        mentions: ['a@example.com', 'b@example.com'],
      },
    });
    const stored = bundle._state.comments[0];
    expect(JSON.parse(stored.position as string)).toMatchObject({ selector: '#main' });
    expect(JSON.parse(stored.mentions as string)).toEqual(['a@example.com', 'b@example.com']);
  });

  it('omits empty mentions and absent position/state', async () => {
    const bundle = createCommentsDb();
    const ctx = ctxFromDb(bundle);
    await handleComments(
      commentsRequest('/', { method: 'POST', body: JSON.stringify({ content: 'plain', authorName: 'Pat' }) }),
      ctx,
      '/'
    );
    const stored = bundle._state.comments[0];
    expect(stored.position).toBeNull();
    expect(stored.state).toBeNull();
    expect(stored.mentions).toBeNull();
  });
});

