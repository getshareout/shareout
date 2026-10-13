/**
 * "@AI" in a comment → the page editor agent edits the artifact, publishes a new
 * version (undoable from version history) and answers in the same thread.
 *
 * Runs after the comment response (waitUntil). Same gates as the chat agent's
 * edit_page / edit_publish: owner or editor only, the per-user AI chat limit,
 * the daily publish limit and the storage quota.
 */
import type { DataContext } from '../middleware';
import type { Comment } from './types';
import { createCommentForTool } from './tool';
import { broadcastEvent } from './broadcast';
import { dispatchCommentNotify } from '../comment-notify';
import { proposeEdit, publishEdits } from '../agent/headless-edit';
import { resolveArtifactAccessForUser } from '../../chat-agent/access';
import { checkAiChatLimit } from '../../rate-limit';
import { checkRateLimit, incrementRateLimit } from '../../api-auth';
import { checkStorageQuota } from '../../quota';
import { rateLimitMessage, storageLimitMessage } from '../../publish/limits';
import { localeForRecipient, type Locale } from '../../i18n/locale';
import { t } from '../../i18n';
import { createLogger } from '../../logging';

/** `@AI` is the primary handle ("Ask AI" in the UI); `@IA` and `@ShareOut` also work. */
const AI_HANDLE = /(^|[^\w@.])@(ai|ia|shareout)(?![\w.@-])/i;

export function mentionsAi(content: string): boolean {
  return AI_HANDLE.test(content);
}

const COPY = {
  en: {
    author: 'AI',
    working: 'Working on it…',
    signIn: 'Sign in with edit access to this page to ask me for changes.',
    noAccess: 'Only the owner or an editor of this page can ask me to change it.',
    empty: 'Tell me what to change after @AI.',
    tooFast: 'You’re going a bit fast for me. Give it a minute and try again.',
    published: (summary: string, url: string | null) => `Done, published a new version.${summary ? `\n\n${summary}` : ''}${url ? `\n\n${url}` : ''}\n\nUndo it from version history.`,
    failed: (err: string) => `I couldn’t make that change: ${err}`,
    crashed: 'Something went wrong making that change. Try again?',
  },
  es: {
    author: 'IA',
    working: 'Estoy en eso…',
    signIn: 'Iniciá sesión con permiso de edición en esta página para pedirme cambios.',
    noAccess: 'Solo el dueño o un editor de esta página puede pedirme que la cambie.',
    empty: 'Decime qué cambiar después de @IA.',
    tooFast: 'Vas un poco rápido para mí. Esperá un minuto y probá de nuevo.',
    published: (summary: string, url: string | null) => `Listo, publiqué una nueva versión.${summary ? `\n\n${summary}` : ''}${url ? `\n\n${url}` : ''}\n\nPodés deshacerlo desde el historial de versiones.`,
    failed: (err: string) => `No pude hacer ese cambio: ${err}`,
    crashed: 'Algo falló al hacer ese cambio. ¿Probás de nuevo?',
  },
};

type Copy = (typeof COPY)['en'];

async function instructionFor(ctx: DataContext, comment: Comment): Promise<string> {
  const ask = comment.content.replace(new RegExp(AI_HANDLE.source, 'gi'), '$1').trim();
  if (!ask || !comment.parentId) return ask;
  const parent = await ctx.env.DB.prepare('SELECT content FROM artifact_comments WHERE artifact_id = ? AND id = ?')
    .bind(ctx.artifactId, comment.parentId).first<{ content: string }>();
  return parent?.content ? `${ask}\n\n(Replying to this comment on the page: "${parent.content.slice(0, 1000)}")` : ask;
}

/** Edit the artifact for an @AI comment and reply in its thread. Never throws. */
export async function runCommentAiEdit(ctx: DataContext, comment: Comment): Promise<void> {
  const env = ctx.env;
  const userId = comment.authorId;
  const locale: Locale = await localeForRecipient(env, { userId, workspaceId: ctx.workspaceId || null }).catch((): Locale => 'en');
  const c: Copy = t(locale, COPY);
  const parentId = comment.parentId ?? comment.id;
  const say = (content: string) => createCommentForTool(ctx, { id: 'shareout-ai', name: c.author }, { content, parentId, notify: false });

  try {
    if (!userId) { await say(c.signIn); return; }
    const access = await resolveArtifactAccessForUser(env, ctx.artifactId, userId);
    if (!access || (access.role !== 'owner' && access.role !== 'editor')) { await say(c.noAccess); return; }

    const instruction = await instructionFor(ctx, comment);
    if (!instruction) { await say(c.empty); return; }

    if (!(await checkAiChatLimit(env, userId)).allowed) { await say(c.tooFast); return; }
    const user = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(userId).first<{ email: string | null }>();
    const rate = await checkRateLimit(env, userId, 'publish', user?.email);
    if (!rate.allowed) { await say(c.failed(rateLimitMessage(rate.reset))); return; }

    const placeholder = await say(c.working);
    if ('error' in placeholder) return;
    const finish = async (content: string) => {
      const updatedAt = new Date().toISOString();
      await env.DB.prepare('UPDATE artifact_comments SET content = ?, updated_at = ? WHERE id = ?')
        .bind(content, updatedAt, placeholder.comment.id).run();
      const done = { ...placeholder.comment, content, updatedAt };
      await broadcastEvent(ctx, { type: 'comment:updated', comment: done });
      dispatchCommentNotify(ctx, done);
    };

    try {
      const proposed = await proposeEdit(env, ctx.artifactId, instruction);
      if (!proposed.ok) { await finish(c.failed(proposed.error)); return; }
      if (!proposed.files.length) { await finish(proposed.explanation); return; }

      const art = await env.DB.prepare('SELECT owner_id FROM artifacts WHERE id = ?').bind(ctx.artifactId).first<{ owner_id: string }>();
      const pending = await env.DB.prepare(
        `SELECT file_path, new_content FROM artifact_pending_edits WHERE artifact_id = ? AND thread_id = ? AND status = 'pending'`
      ).bind(ctx.artifactId, proposed.conversationId).all<{ file_path: string; new_content: string | null }>();
      const files = pending.results.map((p) => ({ path: p.file_path, content: p.new_content ?? '', mime: 'text/plain' }));
      const quota = await checkStorageQuota(env, art?.owner_id ?? userId, files);
      if (!quota.allowed) { await finish(c.failed(storageLimitMessage(quota))); return; }

      const published = await publishEdits(env, ctx.artifactId, proposed.conversationId);
      if (!published.ok) { await finish(c.failed(published.error)); return; }
      await incrementRateLimit(env, userId, 'publish', user?.email);
      await finish(c.published(proposed.explanation, published.url));
    } catch (err) {
      createLogger(env, { scope: 'comments.ai-edit' }).error('comment AI edit failed', { artifact_id: ctx.artifactId, comment_id: comment.id, err });
      await finish(c.crashed).catch(() => undefined);
    }
  } catch (err) {
    createLogger(env, { scope: 'comments.ai-edit' }).error('comment AI edit failed', { artifact_id: ctx.artifactId, comment_id: comment.id, err });
  }
}
