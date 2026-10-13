// @vitest-environment node
/**
 * "@AI" in a comment → edit + publish + reply in the thread, behind the same
 * owner/editor gate and publish limits as the chat agent's edit_page.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataContext } from '../../../../src/data/middleware';
import type { Comment } from '../../../../src/data/comments/types';

const m = vi.hoisted(() => ({
  createCommentForTool: vi.fn(),
  broadcastEvent: vi.fn(),
  dispatchCommentNotify: vi.fn(),
  proposeEdit: vi.fn(),
  publishEdits: vi.fn(),
  resolveArtifactAccessForUser: vi.fn(),
  checkAiChatLimit: vi.fn(),
  checkRateLimit: vi.fn(),
  incrementRateLimit: vi.fn(),
  checkStorageQuota: vi.fn(),
  localeForRecipient: vi.fn(),
}));

vi.mock('../../../../src/data/comments/tool', () => ({ createCommentForTool: m.createCommentForTool }));
vi.mock('../../../../src/data/comments/broadcast', () => ({ broadcastEvent: m.broadcastEvent }));
vi.mock('../../../../src/data/comment-notify', () => ({ dispatchCommentNotify: m.dispatchCommentNotify }));
vi.mock('../../../../src/data/agent/headless-edit', () => ({ proposeEdit: m.proposeEdit, publishEdits: m.publishEdits }));
vi.mock('../../../../src/chat-agent/access', () => ({ resolveArtifactAccessForUser: m.resolveArtifactAccessForUser }));
vi.mock('../../../../src/rate-limit', () => ({ checkAiChatLimit: m.checkAiChatLimit }));
vi.mock('../../../../src/api-auth', () => ({ checkRateLimit: m.checkRateLimit, incrementRateLimit: m.incrementRateLimit, RATE_LIMIT_MAX: 100 }));
vi.mock('../../../../src/quota', () => ({ checkStorageQuota: m.checkStorageQuota }));
vi.mock('../../../../src/i18n/locale', () => ({ localeForRecipient: m.localeForRecipient }));

import { mentionsAi, runCommentAiEdit } from '../../../../src/data/comments/ai-edit';

const updates: Array<{ content: string; id: string }> = [];
const db = {
  prepare: (sql: string) => ({
    bind: (...args: unknown[]) => ({
      first: async () => {
        if (sql.includes('FROM users')) return { email: 'me@example.com' };
        if (sql.includes('FROM artifacts')) return { owner_id: 'usr_owner' };
        if (sql.includes('FROM artifact_comments')) return { content: 'The chart is hard to read' };
        return null;
      },
      all: async () => ({ results: [{ file_path: 'index.html', new_content: '<h1>new</h1>' }] }),
      run: async () => { if (sql.startsWith('UPDATE artifact_comments')) updates.push({ content: args[0] as string, id: args[2] as string }); return {}; },
    }),
  }),
};
const ctx = { artifactId: 'art_1', workspaceId: '', env: { DB: db } } as unknown as DataContext;

function comment(over: Partial<Comment> = {}): Comment {
  return {
    id: 'cmt_1', contextId: null, parentId: null, authorId: 'usr_editor', authorName: 'Ed',
    content: '@AI make the chart a bar chart', createdAt: '', updatedAt: '', resolved: false,
    resolvedBy: null, resolvedAt: null, position: null, state: null, mentions: [],
    authorType: 'human', assigneeUserId: null, assigneeEmail: null, dueAt: null, ...over,
  };
}

const replies = () => m.createCommentForTool.mock.calls.map((c) => c[2].content as string);

beforeEach(() => {
  updates.length = 0;
  Object.values(m).forEach((f) => f.mockReset());
  m.createCommentForTool.mockImplementation(async (_c, author, body) => ({ comment: comment({ id: 'cmt_ai', authorId: author.id, authorName: author.name, content: body.content, parentId: body.parentId, authorType: 'agent' }) }));
  m.localeForRecipient.mockResolvedValue('en');
  m.resolveArtifactAccessForUser.mockResolvedValue({ role: 'editor' });
  m.checkAiChatLimit.mockResolvedValue({ allowed: true });
  m.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 99, reset: 0 });
  m.checkStorageQuota.mockResolvedValue({ allowed: true, used: 0, incoming: 0, max: 0 });
  m.proposeEdit.mockResolvedValue({ ok: true, conversationId: 'conv_1', explanation: 'Switched the chart to bars.', files: ['index.html'] });
  m.publishEdits.mockResolvedValue({ ok: true, url: 'https://x/a/p/' });
});

describe('mentionsAi', () => {
  it('matches @AI, @IA and @ShareOut as standalone handles only', () => {
    expect(mentionsAi('@AI change it')).toBe(true);
    expect(mentionsAi('hola @IA, cambiá el gráfico')).toBe(true);
    expect(mentionsAi('hey @shareout')).toBe(true);
    expect(mentionsAi('mail ai@example.com')).toBe(false);
    expect(mentionsAi('@aisha look')).toBe(false);
    expect(mentionsAi('no handle here')).toBe(false);
  });
});

describe('runCommentAiEdit — permission', () => {
  it('editor: edits, publishes a new version, counts a publish and replies in the thread', async () => {
    await runCommentAiEdit(ctx, comment());
    expect(m.proposeEdit).toHaveBeenCalledWith(ctx.env, 'art_1', 'make the chart a bar chart');
    expect(m.publishEdits).toHaveBeenCalledWith(ctx.env, 'art_1', 'conv_1');
    expect(m.incrementRateLimit).toHaveBeenCalledWith(ctx.env, 'usr_editor', 'publish', 'me@example.com');
    expect(m.createCommentForTool.mock.calls[0][2]).toMatchObject({ content: 'Working on it…', parentId: 'cmt_1', notify: false });
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe('cmt_ai');
    expect(updates[0].content).toContain('Switched the chart to bars.');
    expect(m.broadcastEvent).toHaveBeenCalledWith(ctx, expect.objectContaining({ type: 'comment:updated' }));
  });

  it('viewer: no edit, replies that edit access is needed', async () => {
    m.resolveArtifactAccessForUser.mockResolvedValue({ role: 'viewer' });
    await runCommentAiEdit(ctx, comment());
    expect(m.proposeEdit).not.toHaveBeenCalled();
    expect(m.publishEdits).not.toHaveBeenCalled();
    expect(replies()).toEqual(['Only the owner or an editor of this page can ask me to change it.']);
  });

  it('no access at all (public page, signed-in stranger): refused', async () => {
    m.resolveArtifactAccessForUser.mockResolvedValue(null);
    await runCommentAiEdit(ctx, comment());
    expect(m.proposeEdit).not.toHaveBeenCalled();
    expect(replies()[0]).toMatch(/owner or an editor/);
  });

  it('anonymous commenter: refused without an access lookup', async () => {
    await runCommentAiEdit(ctx, comment({ authorId: null }));
    expect(m.resolveArtifactAccessForUser).not.toHaveBeenCalled();
    expect(m.proposeEdit).not.toHaveBeenCalled();
    expect(replies()[0]).toMatch(/Sign in/);
  });

  it('replies in es-AR for a Spanish-speaking commenter', async () => {
    m.localeForRecipient.mockResolvedValue('es');
    m.resolveArtifactAccessForUser.mockResolvedValue({ role: 'viewer' });
    await runCommentAiEdit(ctx, comment({ content: '@IA cambiá el gráfico' }));
    expect(m.createCommentForTool.mock.calls[0][1]).toEqual({ id: 'shareout-ai', name: 'IA' });
    expect(replies()[0]).toMatch(/Solo el dueño o un editor/);
  });
});

describe('runCommentAiEdit — limits', () => {
  it('daily publish limit: refuses before running the agent', async () => {
    m.checkRateLimit.mockResolvedValue({ allowed: false, remaining: 0, reset: Math.floor(Date.UTC(2030, 0, 2) / 1000) });
    await runCommentAiEdit(ctx, comment());
    expect(m.proposeEdit).not.toHaveBeenCalled();
    expect(replies()[0]).toMatch(/Daily publish limit reached \(100 per day\)/);
  });

  it('AI chat limit: refuses before running the agent', async () => {
    m.checkAiChatLimit.mockResolvedValue({ allowed: false });
    await runCommentAiEdit(ctx, comment());
    expect(m.proposeEdit).not.toHaveBeenCalled();
    expect(m.checkRateLimit).not.toHaveBeenCalled();
  });

  it('storage quota (artifact owner): does not publish or count the publish', async () => {
    m.checkStorageQuota.mockResolvedValue({ allowed: false, used: 50_000_000, incoming: 10, max: 50_000_000 });
    await runCommentAiEdit(ctx, comment());
    expect(m.checkStorageQuota).toHaveBeenCalledWith(ctx.env, 'usr_owner', [expect.objectContaining({ path: 'index.html', content: '<h1>new</h1>' })]);
    expect(m.publishEdits).not.toHaveBeenCalled();
    expect(m.incrementRateLimit).not.toHaveBeenCalled();
    expect(updates[0].content).toMatch(/Storage limit reached/);
  });

  it('agent error: the working reply turns into the error, nothing published', async () => {
    m.proposeEdit.mockResolvedValue({ ok: false, error: 'This page doesn’t have an AI editor configured yet.' });
    await runCommentAiEdit(ctx, comment());
    expect(m.publishEdits).not.toHaveBeenCalled();
    expect(updates[0].content).toMatch(/couldn’t make that change: This page doesn’t have an AI editor/);
  });

  it('a reply in a thread passes the parent comment as context and answers in the same thread', async () => {
    await runCommentAiEdit(ctx, comment({ parentId: 'cmt_root', content: '@AI fix this' }));
    expect(m.proposeEdit.mock.calls[0][2]).toContain('The chart is hard to read');
    expect(m.createCommentForTool.mock.calls[0][2].parentId).toBe('cmt_root');
  });
});
