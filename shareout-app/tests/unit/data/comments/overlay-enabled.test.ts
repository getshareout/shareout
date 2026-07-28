// @vitest-environment node
/**
 * Comments handler tests: handleComments overlayEnabled config.
 */
import './mocks';
import './setup';
import { describe, expect, it } from 'vitest';
import { handleComments } from '../../../../src/data/comments';
import { createSessionToken } from '../../../../src/token';
import { commentsRequest, createCommentsDb, ctxFromDb } from './shared';

describe('handleComments overlayEnabled config', () => {
  it('owner can toggle overlayEnabled and it is reflected on GET', async () => {
    const bundle = createCommentsDb();
    const ctx = ctxFromDb(bundle);
    const session = await createSessionToken('usr_owner', 'owner@example.com', ctx.env);

    const put = await handleComments(
      commentsRequest('/_config', {
        method: 'PUT',
        headers: { Cookie: `shareout_session=${session}` },
        body: JSON.stringify({ overlayEnabled: false }),
      }),
      ctx,
      '/_config'
    );
    expect(put.status).toBe(200);
    await expect(put.json()).resolves.toMatchObject({ data: { overlayEnabled: false } });

    const get = await handleComments(commentsRequest('/_config'), ctx, '/_config');
    await expect(get.json()).resolves.toMatchObject({ data: { overlayEnabled: false } });
  });
});

