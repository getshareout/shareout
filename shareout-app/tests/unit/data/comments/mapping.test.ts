// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { rowToComment, safeParse, getCommentDepth } from '../../../../src/data/comments/mapping';
import type { CommentRow } from '../../../../src/data/comments/types';
import type { DataContext } from '../../../../src/data/middleware';

function makeRow(overrides: Partial<CommentRow> = {}): CommentRow {
  return {
    id: 'cmt_000000000000000000000001',
    context_id: 'ctx-1',
    parent_id: null,
    author_id: 'usr_1',
    author_name: 'Alice',
    content: 'Hello',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('comments/mapping', () => {
  describe('safeParse', () => {
    it('returns null for empty input', () => {
      expect(safeParse(null)).toBeNull();
      expect(safeParse(undefined)).toBeNull();
      expect(safeParse('')).toBeNull();
    });

    it('parses valid JSON', () => {
      expect(safeParse('["a","b"]')).toEqual(['a', 'b']);
    });

    it('returns null for invalid JSON', () => {
      expect(safeParse('{not json')).toBeNull();
    });
  });

  describe('rowToComment', () => {
    it('maps snake_case row to camelCase comment', () => {
      const comment = rowToComment(makeRow({
        resolved: 1,
        resolved_by: 'bob@example.com',
        resolved_at: '2026-01-02T00:00:00.000Z',
        mentions: '["@bob"]',
        author_type: 'agent',
        assignee_email: 'carol@example.com',
        due_at: '2026-02-01T00:00:00.000Z',
      }));

      expect(comment).toMatchObject({
        id: 'cmt_000000000000000000000001',
        contextId: 'ctx-1',
        resolved: true,
        resolvedBy: 'bob@example.com',
        mentions: ['@bob'],
        authorType: 'agent',
        assigneeEmail: 'carol@example.com',
        dueAt: '2026-02-01T00:00:00.000Z',
      });
    });

    it('defaults authorType to human and mentions to empty array', () => {
      const comment = rowToComment(makeRow({ mentions: 'not-an-array' }));
      expect(comment.authorType).toBe('human');
      expect(comment.mentions).toEqual([]);
    });
  });

  describe('getCommentDepth', () => {
    it('returns null when the starting comment does not exist', async () => {
      const ctx = {
        artifactId: 'art_1',
        env: { DB: { prepare: () => ({ bind: () => ({ first: async () => null }) }) } },
      } as unknown as DataContext;

      await expect(getCommentDepth(ctx, 'cmt_missing')).resolves.toBeNull();
    });

    it('counts parent chain depth (includes the starting comment)', async () => {
      const parents: Record<string, string | null> = {
        cmt_child: 'cmt_parent',
        cmt_parent: null,
      };

      const ctx = {
        artifactId: 'art_1',
        env: {
          DB: {
            prepare: () => ({
              bind: (_art: string, id: string) => ({
                first: async () => ({ parent_id: parents[id] ?? null }),
              }),
            }),
          },
        },
      } as unknown as DataContext;

      await expect(getCommentDepth(ctx, 'cmt_child')).resolves.toBe(2);
    });
  });
});
