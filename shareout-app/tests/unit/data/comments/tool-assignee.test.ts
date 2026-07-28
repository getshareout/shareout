// @vitest-environment node
/**
 * Comments handler tests: createCommentForTool with assignee.
 */
import './mocks';
import './setup';
import { describe, expect, it } from 'vitest';
import { createCommentForTool } from '../../../../src/data/comments';
import { createCommentsDb, ctxFromDb } from './shared';

describe('createCommentForTool with assignee', () => {
  it('resolves assigneeEmail against the people set', async () => {
    const bundle = createCommentsDb({
      collaborators: [{ email: 'assignee@example.com', role: 'editor' }],
      users: [{ id: 'usr_assignee', email: 'assignee@example.com', name: 'Assignee' }],
    });
    const ctx = ctxFromDb(bundle);
    const result = await createCommentForTool(
      ctx,
      { id: 'crew_1', name: 'Crew' },
      { content: 'Agent task', assigneeEmail: 'assignee@example.com', dueAt: '2026-10-01T00:00:00.000Z' }
    );
    expect('comment' in result).toBe(true);
    if ('comment' in result) {
      expect(result.comment.assigneeEmail).toBe('assignee@example.com');
      expect(result.comment.assigneeUserId).toBe('usr_assignee');
      expect(result.comment.dueAt).toBe('2026-10-01T00:00:00.000Z');
    }
    expect(bundle._state.comments[0].assignee_user_id).toBe('usr_assignee');
  });

  it('errors on an assignee outside the people set', async () => {
    const bundle = createCommentsDb();
    const result = await createCommentForTool(
      ctxFromDb(bundle),
      { id: 'crew_1', name: 'Crew' },
      { content: 'x', assigneeEmail: 'nope@evil.com' }
    );
    expect(result).toMatchObject({ error: expect.stringContaining('assignee') });
  });
});
