// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const { dispatch, getLinkedChatId, sendMessage } = vi.hoisted(() => ({
  dispatch: vi.fn(async () => ({ sent: true })),
  getLinkedChatId: vi.fn(async () => null as number | null),
  sendMessage: vi.fn(async () => undefined),
}));

vi.mock('../../../src/email/gateway', () => ({ dispatchLifecycleEmail: dispatch }));
vi.mock('../../../src/telegram/linking', () => ({ getLinkedChatId }));
vi.mock('../../../src/telegram/client', () => ({ sendMessage }));

import { notifyCommentTargets } from '../../../src/data/comment-notify';
import type { DataContext } from '../../../src/data/middleware';

interface Users { [id: string]: { id: string; email: string; name: string | null } }

function makeCtx(opts: {
  users?: Users;
  parentAuthorId?: string | null;
  artifact?: { name: string | null; slug: string | null };
}): DataContext {
  const users = opts.users ?? {};
  const byEmail = new Map(Object.values(users).map((u) => [u.email.toLowerCase(), u]));

  const DB = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async first<T>() {
              if (sql.includes('SELECT email FROM users WHERE id')) {
                const u = users[String(args[0])];
                return (u ? { email: u.email } : null) as T;
              }
              if (sql.includes('SELECT author_id FROM artifact_comments')) {
                return { author_id: opts.parentAuthorId ?? null } as T;
              }
              if (sql.includes('SELECT id, email, name FROM users WHERE id')) {
                const u = users[String(args[0])];
                return (u ?? null) as T;
              }
              if (sql.includes('SELECT id, email, name FROM users WHERE lower(email)')) {
                const u = byEmail.get(String(args[0]).toLowerCase());
                return (u ?? null) as T;
              }
              if (sql.includes('FROM artifacts')) {
                return (opts.artifact ?? { name: 'Q3 Dashboard', slug: 'q3' }) as T;
              }
              return null as T;
            },
            async all<T>() {
              if (sql.includes('lower(email) IN')) {
                const found = args
                  .map((a) => byEmail.get(String(a).toLowerCase()))
                  .filter(Boolean);
                return { results: found } as { results: T[] };
              }
              // listPeople: every seeded user is a collaborator on the artifact.
              if (sql.includes('FROM collaborators c')) {
                return {
                  results: Object.values(users).map((u) => ({
                    user_id: u.id, email: u.email, name: u.name, role: 'viewer',
                  })),
                } as { results: T[] };
              }
              return { results: [] } as { results: T[] };
            },
          };
        },
      };
    },
  };

  return {
    artifactId: 'art_1',
    artifact: { id: 'art_1', owner_id: null },
    env: { DB, SHAREOUT_BASE_URL: 'https://shareout.site', EMAIL_DEFAULT_FROM: 'noreply@shareout.site' },
  } as unknown as DataContext;
}

afterEach(() => vi.clearAllMocks());

describe('notifyCommentTargets', () => {
  it('emails each @mentioned user', async () => {
    const ctx = makeCtx({
      users: { u_ana: { id: 'u_ana', email: 'ana@co.com', name: 'Ana' } },
    });
    await notifyCommentTargets(ctx, {
      id: 'cmt_1', parentId: null, authorId: 'u_beto', authorName: 'Beto',
      content: 'look at this @ana', mentions: ['ana@co.com'],
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    const params = dispatch.mock.calls[0][1];
    expect(params.toEmail).toBe('ana@co.com');
    expect(params.data.verb).toContain('mentioned you');
  });

  it('does not notify the author about their own mention', async () => {
    const ctx = makeCtx({
      users: { u_ana: { id: 'u_ana', email: 'ana@co.com', name: 'Ana' } },
    });
    await notifyCommentTargets(ctx, {
      id: 'cmt_1', parentId: null, authorId: 'u_ana', authorName: 'Ana',
      content: 'note to self @ana', mentions: ['ana@co.com'],
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('notifies the parent author on a reply', async () => {
    const ctx = makeCtx({
      users: { u_ana: { id: 'u_ana', email: 'ana@co.com', name: 'Ana' } },
      parentAuthorId: 'u_ana',
    });
    await notifyCommentTargets(ctx, {
      id: 'cmt_2', parentId: 'cmt_1', authorId: 'u_beto', authorName: 'Beto',
      content: 'good point', mentions: [],
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][1].data.verb).toContain('replied to your comment');
  });

  it('does not double-notify when the reply also mentions the parent author', async () => {
    const ctx = makeCtx({
      users: { u_ana: { id: 'u_ana', email: 'ana@co.com', name: 'Ana' } },
      parentAuthorId: 'u_ana',
    });
    await notifyCommentTargets(ctx, {
      id: 'cmt_2', parentId: 'cmt_1', authorId: 'u_beto', authorName: 'Beto',
      content: 'thanks @ana', mentions: ['ana@co.com'],
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch.mock.calls[0][1].data.verb).toContain('mentioned you');
  });

  it('also pings Telegram when the recipient has a linked chat', async () => {
    getLinkedChatId.mockResolvedValueOnce(12345);
    const ctx = makeCtx({
      users: { u_ana: { id: 'u_ana', email: 'ana@co.com', name: 'Ana' } },
    });
    await notifyCommentTargets(ctx, {
      id: 'cmt_1', parentId: null, authorId: 'u_beto', authorName: 'Beto',
      content: 'ping @ana', mentions: ['ana@co.com'],
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1]).toBe(12345);
  });

  it('ignores a mention of someone who is not on the artifact', async () => {
    // `mentions` is client input on a comment an anonymous visitor can post — notifying
    // it verbatim would make the instance an open relay.
    const ctx = makeCtx({
      users: { u_ana: { id: 'u_ana', email: 'ana@co.com', name: 'Ana' } },
    });
    await notifyCommentTargets(ctx, {
      id: 'cmt_1', parentId: null, authorId: null, authorName: 'Click here now',
      content: 'you have won', mentions: ['victim@elsewhere.com'],
    });
    expect(dispatch).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('no-ops when there are no recipients', async () => {
    const ctx = makeCtx({});
    await notifyCommentTargets(ctx, {
      id: 'cmt_1', parentId: null, authorId: 'u_beto', authorName: 'Beto',
      content: 'just a note', mentions: [],
    });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('sends an action_item_assigned email to the assignee', async () => {
    const ctx = makeCtx({
      users: { u_ana: { id: 'u_ana', email: 'ana@co.com', name: 'Ana' } },
    });
    await notifyCommentTargets(ctx, {
      id: 'cmt_1', parentId: null, authorId: 'u_beto', authorName: 'Beto',
      content: 'please review', mentions: [], assigneeEmail: 'ana@co.com', dueAt: '2026-08-01T00:00:00.000Z',
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    const params = dispatch.mock.calls[0][1];
    expect(params.type).toBe('action_item_assigned');
    expect(params.toEmail).toBe('ana@co.com');
    expect(params.data.dueStr).toBeTruthy();
  });

  it('does not assign-notify the author self-assigning', async () => {
    const ctx = makeCtx({
      users: { u_ana: { id: 'u_ana', email: 'ana@co.com', name: 'Ana' } },
    });
    await notifyCommentTargets(ctx, {
      id: 'cmt_1', parentId: null, authorId: 'u_ana', authorName: 'Ana',
      content: 'mine', mentions: [], assigneeEmail: 'ana@co.com',
    });
    expect(dispatch).not.toHaveBeenCalled();
  });
});
