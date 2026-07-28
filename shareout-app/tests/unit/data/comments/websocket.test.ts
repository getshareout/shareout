// @vitest-environment node
/**
 * Comments handler tests: handleComments websocket.
 */
import './mocks';
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { handleComments } from '../../../../src/data/comments';
import { ARTIFACT_ID, commentsRequest, createCommentsDb, ctxFromDb } from './shared';

describe('handleComments websocket', () => {
  it('requires websocket upgrade', async () => {
    const bundle = createCommentsDb();
    const response = await handleComments(
      commentsRequest('/ws'),
      ctxFromDb(bundle),
      '/ws'
    );
    expect(response.status).toBe(426);
  });

  it('proxies websocket upgrade to the comments durable object on public artifacts', async () => {
    const bundle = createCommentsDb();
    const ctx = ctxFromDb(bundle); // visibility: public
    const wsResponse = new Response('upgraded', { status: 200 });
    const fetchMock = vi.fn().mockResolvedValue(wsResponse);
    bundle.commentsDo.get.mockReturnValue({ fetch: fetchMock });

    const request = new Request(`https://example.com/v1/data/${ARTIFACT_ID}/comments/ws`, {
      headers: { Upgrade: 'websocket' },
    });
    const response = await handleComments(request, ctx, '/ws');

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(request);
    expect(bundle.commentsDo.idFromName).toHaveBeenCalledWith(ARTIFACT_ID);
  });

  it('requires a session for private artifact comment websockets', async () => {
    const bundle = createCommentsDb();
    const ctx = ctxFromDb(bundle, { visibility: 'private' });
    const request = new Request(`https://example.com/v1/data/${ARTIFACT_ID}/comments/ws`, {
      headers: { Upgrade: 'websocket' },
    });
    const response = await handleComments(request, ctx, '/ws');
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: 'AUTH_REQUIRED' });
  });
});

