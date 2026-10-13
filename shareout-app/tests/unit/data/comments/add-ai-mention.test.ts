// @vitest-environment node
/**
 * Comments handler: an "@AI" comment schedules the AI edit after the response.
 */
import './mocks';
import './setup';
import { describe, expect, it, vi } from 'vitest';

const runCommentAiEdit = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../../../../src/data/comments/ai-edit', async (orig) => ({
  ...(await orig<typeof import('../../../../src/data/comments/ai-edit')>()),
  runCommentAiEdit,
}));

import { handleComments } from '../../../../src/data/comments';
import { commentsRequest, createCommentsDb, ctxFromDb } from './shared';

async function post(content: string) {
  const ctx = ctxFromDb(createCommentsDb());
  const waitUntil = vi.fn();
  ctx.waitUntil = waitUntil;
  const res = await handleComments(
    commentsRequest('/', { method: 'POST', body: JSON.stringify({ content, authorName: 'Pat' }) }),
    ctx,
    '/',
  );
  return { res, waitUntil };
}

describe('handleComments add — @AI mention', () => {
  it('runs the AI edit in the background (waitUntil) and returns 201 right away', async () => {
    runCommentAiEdit.mockClear();
    const { res, waitUntil } = await post('@AI make the chart a bar chart');
    expect(res.status).toBe(201);
    expect(runCommentAiEdit).toHaveBeenCalledOnce();
    expect(runCommentAiEdit.mock.calls[0][1]).toMatchObject({ content: '@AI make the chart a bar chart' });
    expect(waitUntil).toHaveBeenCalledWith(runCommentAiEdit.mock.results[0].value);
  });

  it('does nothing for a comment without the handle', async () => {
    runCommentAiEdit.mockClear();
    const { res } = await post('nice chart, ai@example.com agrees');
    expect(res.status).toBe(201);
    expect(runCommentAiEdit).not.toHaveBeenCalled();
  });
});
