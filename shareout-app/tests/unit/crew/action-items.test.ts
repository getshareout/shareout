import { describe, it, expect, vi } from 'vitest';

// Mock createCommentForTool so action-item-create tests don't need a real DB
const createCommentForToolMock = vi.fn();
vi.mock('../../../src/data/comments', () => ({
  createCommentForTool: (...args: unknown[]) => createCommentForToolMock(...args),
}));

import { actionItemCreateTool } from '../../../src/crew/tools/action-item-create';
import { actionItemListTool } from '../../../src/crew/tools/action-item-list';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeCtx(dbResults: unknown[] = []) {
  const allMock = vi.fn().mockResolvedValue({ results: dbResults });
  const bindMock = vi.fn().mockReturnValue({ all: allMock });
  const prepareMock = vi.fn().mockReturnValue({ bind: bindMock });
  const db = { prepare: prepareMock };

  return {
    ctx: {
      data: {
        artifactId: 'art_1',
        env: { DB: db },
      },
      principal: { crewId: 'crew_1', runId: 'run_1', ownerId: 'usr_1', artifactId: 'art_1', workspaceId: 'wsp_1' },
      limits: {},
    } as never,
    db,
    prepareMock,
    bindMock,
    allMock,
  };
}

// ── action_item_create ────────────────────────────────────────────────────────

describe('action_item_create tool', () => {
  it('happy path: calls createCommentForTool and returns commentId + assignee', async () => {
    createCommentForToolMock.mockResolvedValueOnce({
      comment: { id: 'cmt_abc', assigneeEmail: 'alice@example.com', dueAt: '2026-08-01' },
    });
    const { ctx } = makeCtx();
    const res = await actionItemCreateTool.execute(ctx, {
      content: 'Ship it',
      assignee_email: 'alice@example.com',
      due_at: '2026-08-01',
    });
    expect(res).toEqual({ commentId: 'cmt_abc', assigneeEmail: 'alice@example.com', dueAt: '2026-08-01' });
    expect(createCommentForToolMock).toHaveBeenCalledWith(
      ctx.data,
      { id: 'crew_1', name: 'Crew' },
      { content: 'Ship it', assigneeEmail: 'alice@example.com', dueAt: '2026-08-01' }
    );
  });

  it('surfaces ASSIGNEE_NOT_FOUND error from createCommentForTool', async () => {
    createCommentForToolMock.mockResolvedValueOnce({ error: 'assignee is not on this artifact' });
    const { ctx } = makeCtx();
    const res = await actionItemCreateTool.execute(ctx, {
      content: 'Do thing',
      assignee_email: 'nobody@example.com',
    });
    expect((res as { error: string }).error).toMatch(/assignee/);
  });

  it('validates required fields', async () => {
    const { ctx } = makeCtx();
    expect(((await actionItemCreateTool.execute(ctx, { assignee_email: 'a@b.com' })) as { error: string }).error).toMatch(/content/);
    expect(((await actionItemCreateTool.execute(ctx, { content: 'x' })) as { error: string }).error).toMatch(/assignee_email/);
  });

  it('passes due_at as undefined when omitted', async () => {
    createCommentForToolMock.mockResolvedValueOnce({
      comment: { id: 'cmt_1', assigneeEmail: 'a@b.com', dueAt: null },
    });
    const { ctx } = makeCtx();
    await actionItemCreateTool.execute(ctx, { content: 'x', assignee_email: 'a@b.com' });
    const lastCall = createCommentForToolMock.mock.calls[createCommentForToolMock.mock.calls.length - 1];
    const callBody = lastCall[2] as { dueAt: unknown };
    expect(callBody.dueAt).toBeUndefined();
  });
});

// ── action_item_list ──────────────────────────────────────────────────────────

const baseRow = {
  id: 'cmt_1',
  content: 'Do thing',
  assignee_email: 'alice@example.com',
  due_at: '2026-08-01',
  resolved: 0,
  resolved_by: null,
  resolved_at: null,
  author_name: 'Crew',
  created_at: '2026-07-01T00:00:00Z',
};

describe('action_item_list tool', () => {
  it('returns mapped rows', async () => {
    const { ctx } = makeCtx([baseRow]);
    const res = await actionItemListTool.execute(ctx, {});
    expect(res).toEqual([
      {
        id: 'cmt_1',
        content: 'Do thing',
        assigneeEmail: 'alice@example.com',
        dueAt: '2026-08-01',
        resolved: false,
        resolvedBy: null,
        resolvedAt: null,
        authorName: 'Crew',
        createdAt: '2026-07-01T00:00:00Z',
      },
    ]);
  });

  it('excludes resolved by default (resolved=0 clause in SQL)', async () => {
    const { ctx, prepareMock } = makeCtx([]);
    await actionItemListTool.execute(ctx, {});
    const sql: string = prepareMock.mock.calls[0][0];
    expect(sql).toContain('resolved = 0');
  });

  it('omits resolved=0 clause when include_resolved=true', async () => {
    const { ctx, prepareMock } = makeCtx([]);
    await actionItemListTool.execute(ctx, { include_resolved: true });
    const sql: string = prepareMock.mock.calls[0][0];
    expect(sql).not.toContain('resolved = 0');
  });

  it('adds assignee_email filter when provided', async () => {
    const { ctx, bindMock } = makeCtx([]);
    await actionItemListTool.execute(ctx, { assignee_email: 'Alice@Example.com' });
    const boundArgs: unknown[] = bindMock.mock.calls[0];
    // second binding arg should be lowercased filter
    expect(boundArgs).toContain('alice@example.com');
  });

  it('does not add assignee filter when omitted', async () => {
    const { ctx, prepareMock } = makeCtx([]);
    await actionItemListTool.execute(ctx, {});
    const sql: string = prepareMock.mock.calls[0][0];
    expect(sql).not.toContain('lower(assignee_email)');
  });

  it('orders by due_at ASC NULLS LAST', async () => {
    const { ctx, prepareMock } = makeCtx([]);
    await actionItemListTool.execute(ctx, {});
    const sql: string = prepareMock.mock.calls[0][0];
    expect(sql).toContain('due_at ASC NULLS LAST');
  });
});
