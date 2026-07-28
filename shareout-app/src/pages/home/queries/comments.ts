/**
 * Inspector comment queries — read thread and post session-authed replies.
 *
 * Same D1 store as `/v1/data/{id}/comments`. Asset-bucket artifacts are file-scoped
 * (`context_id = file:<dlv>`); the Inspector never returns or accepts unscoped
 * bucket comments so private-file threads cannot leak across members.
 */
import type { Env } from '../../../types';
import { getVisibilityScope, placeholders, type VisibilityScope } from '../../../account-links';
import { notifyCommentTargets } from '../../../data/comment-notify';
import { broadcastEvent } from '../../../data/comments/broadcast';
import { isAssetBucketArtifactId, userCanAccessFileComment } from '../../../data/comments/file-comments';
import { MAX_CONTENT_LENGTH } from '../../../data/comments/types';
import { generateId } from '../../../crypto-utils';
import type { DataContext } from '../../../data/middleware';

export interface InspectorComment {
  id: string;
  parent_id: string | null;
  author_id: string | null;
  author_name: string | null;
  author_type: string;
  content: string;
  created_at: string;
  resolved: number;
  // Pin to a section of the artifact (JSON CommentPosition) + @mention emails (JSON array).
  position?: string | null;
  mentions?: string | null;
  context_id?: string | null;
}

/** Confirm the user owns or collaborates on the artifact (Inspector comment scope). */
async function userCanAccessArtifact(
  env: Env,
  vis: VisibilityScope,
  artifactId: string,
): Promise<boolean> {
  const idPh = placeholders(vis.userIds.length);
  const emailPh = placeholders(vis.emails.length);
  const access = await env.DB.prepare(`
    SELECT 1 FROM artifacts a
    LEFT JOIN collaborators c ON c.artifact_id = a.id AND c.email IN (${emailPh})
    WHERE a.id = ? AND a.deleted_at IS NULL AND (a.owner_id IN (${idPh}) OR c.email IN (${emailPh}))
    LIMIT 1
  `).bind(...vis.emails, artifactId, ...vis.userIds, ...vis.emails).first();
  return !!access;
}

/**
 * All comments on a single artifact (incl. threaded replies) for the workspace
 * Inspector — only if the user owns the artifact or is a collaborator. Oldest-first
 * so the client can build threads by parent_id.
 *
 * On asset-bucket artifacts, only comments whose `file:<dlv>` context the user can
 * view are returned (never an unscoped dump of every file thread).
 */
export async function queryArtifactComments(
  env: Env,
  user: { id: string; email: string | null },
  artifactId: string,
  limit = 200,
  visArg?: VisibilityScope,
): Promise<InspectorComment[]> {
  const vis = visArg ?? await getVisibilityScope(env, user);
  if (!(await userCanAccessArtifact(env, vis, artifactId))) return [];
  const lim = Math.min(Math.max(limit, 1), 500);
  const rows = await env.DB.prepare(`
    SELECT id, parent_id, author_id, author_name, author_type, content, created_at, resolved, position, mentions, context_id
    FROM artifact_comments
    WHERE artifact_id = ?
    ORDER BY created_at ASC
    LIMIT ?
  `).bind(artifactId, lim).all<InspectorComment>();
  const list = rows.results || [];

  if (!(await isAssetBucketArtifactId(env, artifactId))) return list;
  if (!user.email) return [];

  // Cache per context_id so a long thread does not re-hit grants for every row.
  const allowed = new Map<string, boolean>();
  const out: InspectorComment[] = [];
  for (const row of list) {
    const ctxKey = row.context_id ?? '';
    if (!allowed.has(ctxKey)) {
      allowed.set(
        ctxKey,
        await userCanAccessFileComment(
          env,
          { id: user.id, email: user.email },
          artifactId,
          row.context_id ?? null,
          'view',
          vis,
        ),
      );
    }
    if (allowed.get(ctxKey)) out.push(row);
  }
  return out;
}

/**
 * Post a comment (or threaded reply) as the signed-in user. Mirrors the data-API
 * addComment insert but is session-authed for the Inspector. Returns the new row,
 * or null if the user can't access the artifact / content is empty.
 *
 * On asset-bucket artifacts, `opts.contextId` must be `file:<dlv>` and the user must
 * have comment access on that file.
 */
export async function addArtifactComment(
  env: Env,
  user: { id: string; email: string | null; name?: string | null },
  artifactId: string,
  content: string,
  parentId: string | null,
  opts?: { mentions?: string[]; position?: unknown; contextId?: string | null },
  visArg?: VisibilityScope,
): Promise<InspectorComment | null> {
  const text = (content || '').trim();
  if (!text) return null;
  if (text.length > MAX_CONTENT_LENGTH) return null;
  const vis = visArg ?? await getVisibilityScope(env, user);
  if (!(await userCanAccessArtifact(env, vis, artifactId))) return null;

  if (await isAssetBucketArtifactId(env, artifactId)) {
    if (!user.email) return null;
    const ok = await userCanAccessFileComment(
      env,
      { id: user.id, email: user.email },
      artifactId,
      opts?.contextId ?? null,
      'comment',
      vis,
    );
    if (!ok) return null;
  }

  const id = generateId('cmt');
  const now = new Date().toISOString();
  const authorName = user.name || user.email || 'You';
  const mentionEmails = Array.isArray(opts?.mentions)
    ? opts!.mentions.map((m) => String(m).trim().toLowerCase()).filter((m) => m.includes('@')).slice(0, 25)
    : [];
  const mentionsJson = mentionEmails.length ? JSON.stringify(mentionEmails) : null;
  const positionJson = opts?.position ? JSON.stringify(opts.position).slice(0, 2000) : null;
  const contextId = opts?.contextId || null;
  await env.DB.prepare(`
    INSERT INTO artifact_comments (id, artifact_id, parent_id, author_id, author_name, content, created_at, updated_at, mentions, position, context_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, artifactId, parentId || null, user.id, authorName, text, now, now, mentionsJson, positionJson, contextId).run();

  const comment = {
    id,
    contextId,
    parentId: parentId || null,
    authorId: user.id,
    authorName,
    content: text,
    createdAt: now,
    updatedAt: now,
    resolved: false,
    resolvedBy: null,
    resolvedAt: null,
    position: opts?.position ?? null,
    state: null,
    mentions: mentionEmails,
    authorType: 'human' as const,
    assigneeUserId: null,
    assigneeEmail: null,
    dueAt: null,
  };

  // Fan out to open viewer panels (best-effort; same as data-tier addComment).
  try {
    await broadcastEvent({ env, artifactId } as unknown as DataContext, {
      type: 'comment:added',
      comment,
    });
  } catch { /* never block the post */ }

  // Best-effort mention/reply notifications.
  if (mentionEmails.length || parentId) {
    try {
      await notifyCommentTargets({ env, artifactId } as unknown as DataContext, {
        id, parentId: parentId || null, authorId: user.id, authorName, content: text, mentions: mentionEmails,
      });
    } catch { /* never block the post */ }
  }
  return {
    id, parent_id: parentId || null, author_id: user.id, author_name: authorName,
    author_type: 'human', content: text, created_at: now, resolved: 0,
    position: positionJson, mentions: mentionsJson, context_id: contextId,
  };
}
