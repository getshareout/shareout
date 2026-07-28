// @vitest-environment node
/**
 * Comments handler tests: handleComments _people.
 */
import './mocks';
import './setup';
import { describe, expect, it } from 'vitest';
import { handleComments } from '../../../../src/data/comments';
import { createSessionToken } from '../../../../src/token';
import { commentsRequest, createCommentsDb, ctxFromDb } from './shared';

describe('handleComments _people', () => {
  it('returns deduped collaborators for a logged-in viewer', async () => {
    const bundle = createCommentsDb({
      collaborators: [
        { email: 'alice@example.com', role: 'viewer' },
        { email: 'alice@example.com', role: 'viewer' },
        { email: 'bob@example.com', role: 'editor' },
      ],
    });
    const ctx = ctxFromDb(bundle);
    const session = await createSessionToken('usr_owner', 'owner@example.com', ctx.env);

    const res = await handleComments(
      commentsRequest('/_people', { headers: { Cookie: `shareout_session=${session}` } }),
      ctx,
      '/_people'
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { data: { people: Array<{ email: string }> } };
    expect(body.data.people.map((p) => p.email).sort())
      .toEqual(['alice@example.com', 'bob@example.com', 'owner@example.com']);
  });

  it('requires authentication', async () => {
    const bundle = createCommentsDb({ collaborators: [{ email: 'alice@example.com', role: 'viewer' }] });
    const res = await handleComments(commentsRequest('/_people'), ctxFromDb(bundle), '/_people');
    expect(res.status).toBe(401);
  });

  it('refuses a signed-in stranger — the roster is not public', async () => {
    // A PUBLIC artifact needs no auth to view, so a bare session must not be enough
    // to enumerate the workspace's members and their emails.
    const bundle = createCommentsDb({
      collaborators: [{ email: 'alice@example.com', role: 'viewer' }],
    });
    const ctx = ctxFromDb(bundle);
    const session = await createSessionToken('usr_stranger', 'stranger@nowhere.com', ctx.env);

    const res = await handleComments(
      commentsRequest('/_people', { headers: { Cookie: `shareout_session=${session}` } }),
      ctx,
      '/_people'
    );

    expect(res.status).toBe(403);
  });
});

