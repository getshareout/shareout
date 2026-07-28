// @vitest-environment node
/**
 * Comments handler tests: handleComments config.
 */
import './mocks';
import './setup';
import { describe, expect, it } from 'vitest';
import { handleComments } from '../../../../src/data/comments';
import { createSessionToken } from '../../../../src/token';
import { commentsRequest, createCommentsDb, ctxFromDb } from './shared';

describe('handleComments config', () => {
  it('returns default config on GET /_config', async () => {
    const bundle = createCommentsDb();
    const response = await handleComments(
      commentsRequest('/_config'),
      ctxFromDb(bundle),
      '/_config'
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        enabled: true,
        identityMode: 'anonymous',
        allowReplies: true,
        maxDepth: 3,
      },
    });
  });

  it('merges stored config and falls back on invalid JSON', async () => {
    const withPartial = createCommentsDb({
      config: { identityMode: 'named', maxDepth: 5 },
    });
    const getPartial = await handleComments(
      commentsRequest('/_config'),
      ctxFromDb(withPartial),
      '/_config'
    );
    await expect(getPartial.json()).resolves.toMatchObject({
      success: true,
      data: { identityMode: 'named', maxDepth: 5, enabled: true },
    });

    const corrupt = createCommentsDb({ config: 'not-json{{{' });
    const getCorrupt = await handleComments(
      commentsRequest('/_config'),
      ctxFromDb(corrupt),
      '/_config'
    );
    await expect(getCorrupt.json()).resolves.toMatchObject({
      success: true,
      data: { identityMode: 'anonymous' },
    });
  });

  it('rejects non-owner config updates', async () => {
    const bundle = createCommentsDb();
    const response = await handleComments(
      commentsRequest('/_config', {
        method: 'PUT',
        body: JSON.stringify({ enabled: false }),
      }),
      ctxFromDb(bundle),
      '/_config'
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: 'FORBIDDEN',
    });
  });

  it('allows owner to update config with validation', async () => {
    const bundle = createCommentsDb();
    const ctx = ctxFromDb(bundle);
    const session = await createSessionToken('usr_owner', 'owner@example.com', ctx.env);

    const badJson = await handleComments(
      commentsRequest('/_config', {
        method: 'PUT',
        headers: { Cookie: `shareout_session=${session}` },
        body: 'not-json',
      }),
      ctx,
      '/_config'
    );
    expect(badJson.status).toBe(400);

    const badMode = await handleComments(
      commentsRequest('/_config', {
        method: 'PUT',
        headers: { Cookie: `shareout_session=${session}` },
        body: JSON.stringify({ identityMode: 'invalid' }),
      }),
      ctx,
      '/_config'
    );
    expect(badMode.status).toBe(400);

    const badDepth = await handleComments(
      commentsRequest('/_config', {
        method: 'PUT',
        headers: { Cookie: `shareout_session=${session}` },
        body: JSON.stringify({ maxDepth: 11 }),
      }),
      ctx,
      '/_config'
    );
    expect(badDepth.status).toBe(400);

    const ok = await handleComments(
      commentsRequest('/_config', {
        method: 'PUT',
        headers: { Cookie: `shareout_session=${session}` },
        body: JSON.stringify({ identityMode: 'authenticated', maxDepth: 2, allowReplies: false }),
      }),
      ctx,
      '/_config'
    );
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toMatchObject({
      success: true,
      data: { identityMode: 'authenticated', maxDepth: 2, allowReplies: false },
    });
  });

  it('rejects unsupported methods on /_config', async () => {
    const bundle = createCommentsDb();
    const response = await handleComments(
      commentsRequest('/_config', { method: 'DELETE' }),
      ctxFromDb(bundle),
      '/_config'
    );
    expect(response.status).toBe(405);
  });
});

