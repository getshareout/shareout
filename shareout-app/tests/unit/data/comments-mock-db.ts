// @vitest-environment node
/**
 * In-memory D1 mock for comments handler unit tests.
 * Simulates artifact_comments, reactions, reads, collaborators, and config JSON.
 * @module tests/unit/data/comments-mock-db
 */
import { vi } from 'vitest';

export const CONFIG_KEY = '_comments_config';
export const ARTIFACT_ID = 'art_1';

export interface StoredComment {
  id: string;
  artifact_id: string;
  context_id: string | null;
  parent_id: string | null;
  author_id: string | null;
  author_name: string;
  content: string;
  created_at: string;
  updated_at: string;
  resolved?: number;
  resolved_by?: string | null;
  resolved_at?: string | null;
  position?: string | null;
  state?: string | null;
  mentions?: string | null;
  assignee_user_id?: string | null;
  assignee_email?: string | null;
  due_at?: string | null;
}

export interface StoredCollaborator {
  email: string;
  role: string;
}

export interface StoredUser {
  id: string;
  email: string;
  name?: string | null;
}

interface StoredJson {
  id?: string;
  artifact_id: string;
  key: string;
  value: string;
}

export interface CommentsDbBundle {
  db: ReturnType<typeof createCommentsDb>['db'];
  commentsDo: ReturnType<typeof createCommentsDb>['commentsDo'];
  broadcastFetch: ReturnType<typeof vi.fn>;
  _state: {
    comments: StoredComment[];
    jsonRows: StoredJson[];
    collaborators: StoredCollaborator[];
    users: StoredUser[];
  };
}

/** Composite key for grouping reactions in the mock (unit separator, not NUL). */
const REACTION_KEY_SEP = '\x1f';

export function createCommentsDb(initial?: {
  comments?: StoredComment[];
  config?: Record<string, unknown> | string;
  ownerId?: string | null;
  ownerEmail?: string | null;
  broadcastFails?: boolean;
  collaborators?: StoredCollaborator[];
  users?: StoredUser[];
}): CommentsDbBundle {
  const comments: StoredComment[] = [...(initial?.comments ?? [])];
  const collaborators: StoredCollaborator[] = [...(initial?.collaborators ?? [])];
  const users: StoredUser[] = [...(initial?.users ?? [])];
  const reactions: Array<{ id: string; comment_id: string; user_id: string; emoji: string }> = [];
  const reads: Array<{ user_id: string; artifact_id: string; last_read_at: string }> = [];
  const jsonRows: StoredJson[] = [];
  if (initial?.config !== undefined) {
    const value = typeof initial.config === 'string'
      ? initial.config
      : JSON.stringify(initial.config);
    jsonRows.push({ id: 'jsn_seed', artifact_id: ARTIFACT_ID, key: CONFIG_KEY, value });
  }

  const ownerId = initial?.ownerId ?? 'usr_owner';
  const ownerEmail = initial?.ownerEmail ?? 'owner@example.com';

  const broadcastFetch = vi.fn(async () => new Response('ok'));

  const commentsDo = {
    idFromName: vi.fn((name: string) => ({ name })),
    get: vi.fn(() => ({
      fetch: initial?.broadcastFails
        ? vi.fn(async () => { throw new Error('broadcast down'); })
        : broadcastFetch,
    })),
  };

  function commentById(id: string) {
    return comments.find((c) => c.artifact_id === ARTIFACT_ID && c.id === id);
  }

  function mapRow(row: StoredComment) {
    return {
      id: row.id,
      context_id: row.context_id,
      parent_id: row.parent_id,
      author_id: row.author_id,
      author_name: row.author_name,
      content: row.content,
      created_at: row.created_at,
      updated_at: row.updated_at,
      resolved: row.resolved ?? 0,
      resolved_by: row.resolved_by ?? null,
      resolved_at: row.resolved_at ?? null,
      position: row.position ?? null,
      state: row.state ?? null,
      mentions: row.mentions ?? null,
      assignee_user_id: row.assignee_user_id ?? null,
      assignee_email: row.assignee_email ?? null,
      due_at: row.due_at ?? null,
    };
  }

  const db = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: unknown[]) => ({
        first: vi.fn(async () => {
          if (sql.includes('SELECT value FROM artifact_json')) {
            const row = jsonRows.find(
              (r) => r.artifact_id === args[0] && r.key === args[1]
            );
            return row ? { value: row.value } : null;
          }

          if (sql.includes('SELECT id FROM artifact_json')) {
            const row = jsonRows.find(
              (r) => r.artifact_id === args[0] && r.key === args[1]
            );
            return row ? { id: row.id } : null;
          }

          if (sql.includes('SELECT owner_id FROM artifacts')) {
            return ownerId ? { owner_id: ownerId } : { owner_id: null };
          }

          if (sql.includes('SELECT id FROM users WHERE id = ? AND email = ?')) {
            const [uid, email] = args as [string, string];
            if (uid === ownerId && email === ownerEmail) return { id: uid };
            return null;
          }

          if (sql.includes('SELECT id, email FROM users WHERE id = ?')) {
            const u = users.find((x) => x.id === args[0]);
            return u ? { id: u.id, email: u.email } : null;
          }

          // listPeople's owner lookup.
          if (sql.includes('SELECT id, email, name FROM users WHERE id = ?')) {
            const u = users.find((x) => x.id === args[0]);
            if (u) return { id: u.id, email: u.email, name: u.name ?? null };
            if (args[0] === ownerId && ownerEmail) {
              return { id: ownerId, email: ownerEmail, name: null };
            }
            return null;
          }

          if (sql.includes('SELECT parent_id FROM artifact_comments')) {
            const row = commentById(args[1] as string);
            return row ? { parent_id: row.parent_id } : null;
          }

          if (sql.includes('SELECT * FROM artifact_comments WHERE artifact_id = ? AND id = ?')) {
            const row = commentById(args[1] as string);
            return row ? mapRow(row) : null;
          }

          if (sql.includes('SELECT id FROM artifact_comments WHERE artifact_id = ? AND id = ?')) {
            const row = commentById(args[1] as string);
            return row ? { id: row.id } : null;
          }

          if (sql.includes('SELECT id FROM comment_reactions')) {
            const [commentId, userId, emoji] = args as [string, string, string];
            const r = reactions.find((x) => x.comment_id === commentId && x.user_id === userId && x.emoji === emoji);
            return r ? { id: r.id } : null;
          }

          if (sql.includes('SELECT last_read_at FROM comment_reads')) {
            const [userId, artifactId] = args as [string, string];
            const r = reads.find((x) => x.user_id === userId && x.artifact_id === artifactId);
            return r ? { last_read_at: r.last_read_at } : null;
          }

          if (sql.includes('COUNT(*) AS n FROM artifact_comments')) {
            const [artifactId, since, userId] = args as [string, string, string];
            const n = comments.filter((c) =>
              c.artifact_id === artifactId && c.created_at > since && c.author_id !== userId
            ).length;
            return { n };
          }

          return null;
        }),
        all: vi.fn(async () => {
          if (sql.includes('SELECT * FROM artifact_comments WHERE artifact_id = ?')) {
            let matched = comments.filter((c) => c.artifact_id === ARTIFACT_ID);

            if (sql.includes('AND context_id = ?')) {
              const contextId = args[1] as string;
              matched = matched.filter((c) => c.context_id === contextId);
            }

            if (sql.includes('parent_id IS NULL')) {
              matched = matched.filter((c) => c.parent_id === null);
            } else if (sql.includes('AND parent_id = ?')) {
              const parentFilter = args.find((_, i) => i > 0 && typeof args[i] === 'string'
                && (args[i] as string).startsWith('cmt_')) as string | undefined;
              const parentId = sql.includes('ORDER BY created_at ASC')
                ? (args[1] as string)
                : parentFilter;
              if (parentId && parentId.startsWith('cmt_')) {
                matched = matched.filter((c) => c.parent_id === parentId);
              }
            }

            if (sql.includes('AND resolved = 1')) {
              matched = matched.filter((c) => (c.resolved ?? 0) === 1);
            } else if (sql.includes('AND resolved = 0')) {
              matched = matched.filter((c) => (c.resolved ?? 0) === 0);
            }

            if (sql.includes('assignee_user_id = ? OR lower(assignee_email)')) {
              const idx = args.findIndex((a, i) => i > 0 && typeof a === 'string' && (a as string).startsWith('usr_'));
              const userId = args[idx] as string;
              const email = (args[idx + 1] as string).toLowerCase();
              matched = matched.filter((c) =>
                c.assignee_user_id === userId ||
                (c.assignee_email ?? '').toLowerCase() === email);
            } else if (sql.includes('AND lower(assignee_email) = lower(?)')) {
              const email = (args.find((a, i) => i > 0 && typeof a === 'string' && (a as string).includes('@')) as string).toLowerCase();
              matched = matched.filter((c) => (c.assignee_email ?? '').toLowerCase() === email);
            }

            if (sql.includes('ORDER BY created_at DESC')) {
              matched = [...matched].sort((a, b) => b.created_at.localeCompare(a.created_at));
              const limit = args[args.length - 2] as number;
              const skip = args[args.length - 1] as number;
              matched = matched.slice(skip, skip + limit);
            } else if (sql.includes('ORDER BY created_at ASC')) {
              matched = [...matched].sort((a, b) => a.created_at.localeCompare(b.created_at));
            }

            return { results: matched.map(mapRow) };
          }

          if (sql.includes('FROM comment_reactions')) {
            const viewerId = args[0] as string;
            const ids = args.slice(1) as string[];
            const groups = new Map<string, { count: number; mine: number }>();
            for (const r of reactions) {
              if (!ids.includes(r.comment_id)) continue;
              const key = r.comment_id + '' + r.emoji;
              const g = groups.get(key) ?? { count: 0, mine: 0 };
              g.count += 1;
              if (r.user_id === viewerId) g.mine += 1;
              groups.set(key, g);
            }
            return {
              results: [...groups.entries()].map(([key, g]) => {
                const [comment_id, emoji] = key.split('');
                return { comment_id, emoji, count: g.count, mine: g.mine };
              }),
            };
          }

          if (sql.includes('FROM collaborators c')) {
            return {
              results: collaborators.map((c) => {
                const u = users.find((x) => x.email.toLowerCase() === c.email.toLowerCase());
                return {
                  user_id: u?.id ?? null,
                  email: c.email,
                  name: u?.name ?? null,
                  role: c.role,
                };
              }),
            };
          }

          return { results: [] };
        }),
        run: vi.fn(async () => {
          if (sql.includes('INSERT INTO artifact_json')) {
            const [id, artifactId, key, value] = args as [string, string, string, string];
            jsonRows.push({ id, artifact_id: artifactId, key, value });
            return { success: true, meta: { changes: 1 } };
          }

          if (sql.includes('UPDATE artifact_json SET value')) {
            const [value, , , id] = args as [string, number, string, string];
            const row = jsonRows.find((r) => r.id === id);
            if (row) row.value = value;
            return { success: true, meta: { changes: 1 } };
          }

          if (sql.includes('INSERT INTO artifact_comments')) {
            // createCommentForTool binds parent_id/position/state as SQL literals,
            // so its arg layout differs from addComment's.
            if (sql.includes("'agent'")) {
              const [id, artifactId, contextId, authorId, authorName, content, createdAt, updatedAt, mentions, aUserId, aEmail, dueAt] =
                args as (string | null)[];
              comments.push({
                id: id as string, artifact_id: artifactId as string, context_id: contextId,
                parent_id: null, author_id: authorId, author_name: authorName as string,
                content: content as string, created_at: createdAt as string, updated_at: updatedAt as string,
                position: null, state: null, mentions: mentions ?? null,
                assignee_user_id: aUserId ?? null, assignee_email: aEmail ?? null, due_at: dueAt ?? null,
              });
              return { success: true, meta: { changes: 1 } };
            }
            const [
              id, artifactId, contextId, parentId, authorId, authorName, content, createdAt, updatedAt,
              position, state, mentions, aUserId, aEmail, dueAt,
            ] = args as (string | null)[];
            comments.push({
              id: id as string,
              artifact_id: artifactId as string,
              context_id: contextId,
              parent_id: parentId,
              author_id: authorId,
              author_name: authorName as string,
              content: content as string,
              created_at: createdAt as string,
              updated_at: updatedAt as string,
              position: position ?? null,
              state: state ?? null,
              mentions: mentions ?? null,
              assignee_user_id: aUserId ?? null,
              assignee_email: aEmail ?? null,
              due_at: dueAt ?? null,
            });
            return { success: true, meta: { changes: 1 } };
          }

          if (sql.includes('UPDATE artifact_comments SET resolved = ?')) {
            const [resolved, resolvedBy, resolvedAt, updatedAt, id] = args as [number, string | null, string | null, string, string];
            const row = comments.find((c) => c.id === id);
            if (row) {
              row.resolved = resolved;
              row.resolved_by = resolvedBy;
              row.resolved_at = resolvedAt;
              row.updated_at = updatedAt;
            }
            return { success: true, meta: { changes: 1 } };
          }

          if (sql.includes('UPDATE artifact_comments SET assignee_user_id = ?')) {
            const [aUserId, aEmail, dueAt, updatedAt, id] = args as [string | null, string | null, string | null, string, string];
            const row = comments.find((c) => c.id === id);
            if (row) {
              row.assignee_user_id = aUserId;
              row.assignee_email = aEmail;
              row.due_at = dueAt;
              row.updated_at = updatedAt;
            }
            return { success: true, meta: { changes: 1 } };
          }

          if (sql.includes('UPDATE artifact_comments SET content = ?')) {
            const [content, updatedAt, id] = args as [string, string, string];
            const row = comments.find((c) => c.id === id);
            if (row) {
              row.content = content;
              row.updated_at = updatedAt;
            }
            return { success: true, meta: { changes: 1 } };
          }

          if (sql.includes('DELETE FROM artifact_comments WHERE id = ?')) {
            const id = args[0] as string;
            const idx = comments.findIndex((c) => c.id === id);
            if (idx >= 0) comments.splice(idx, 1);
            return { success: true, meta: { changes: 1 } };
          }

          if (sql.includes('INSERT INTO comment_reactions')) {
            const [id, , comment_id, user_id, emoji] = args as [string, string, string, string, string];
            reactions.push({ id, comment_id, user_id, emoji });
            return { success: true, meta: { changes: 1 } };
          }

          if (sql.includes('DELETE FROM comment_reactions WHERE id = ?')) {
            const id = args[0] as string;
            const idx = reactions.findIndex((r) => r.id === id);
            if (idx >= 0) reactions.splice(idx, 1);
            return { success: true, meta: { changes: 1 } };
          }

          if (sql.includes('INSERT INTO comment_reads')) {
            const [userId, artifactId, lastReadAt] = args as [string, string, string];
            const existing = reads.find((r) => r.user_id === userId && r.artifact_id === artifactId);
            if (existing) existing.last_read_at = lastReadAt;
            else reads.push({ user_id: userId, artifact_id: artifactId, last_read_at: lastReadAt });
            return { success: true, meta: { changes: 1 } };
          }

          return { success: true, meta: { changes: 0 } };
        }),
      })),
    })),
    _state: { comments, jsonRows, collaborators, users },
  };

  return {
    db,
    commentsDo,
    broadcastFetch,
    _state: { comments, jsonRows, collaborators, users },
  };
}
