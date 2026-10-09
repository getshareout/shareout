import type { DataContext } from './middleware';
import { listPeople } from './comments/people';
import { dispatchLifecycleEmail } from '../email/gateway';
import { getLinkedChatId } from '../telegram/linking';
import { sendMessage } from '../telegram/client';
import { getPlatformOrigin } from '../config/origins';
import { localeForRecipient, localeTag, t, type Locale } from '../i18n';

export interface NotifyComment {
  id: string;
  parentId: string | null;
  authorId: string | null;
  authorName: string;
  content: string;
  mentions: string[];
  assigneeEmail?: string | null;
  dueAt?: string | null;
}

interface Recipient {
  userId: string | null;
  email: string;
  name: string | null;
  reason: 'assigned' | 'mention' | 'reply';
}

const SNIPPET_MAX = 280;

async function artifactMeta(ctx: DataContext): Promise<{ title: string; url: string; workspaceId?: string }> {
  const art = await ctx.env.DB.prepare(
    `SELECT a.name AS name, d.slug AS slug, a.workspace_id AS workspace_id FROM artifacts a
     LEFT JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
     WHERE a.id = ?`
  ).bind(ctx.artifactId).first<{ name: string | null; slug: string | null; workspace_id: string | null }>();
  const title = art?.name?.trim() || 'an artifact';
  const base = getPlatformOrigin(ctx.env);
  const url = art?.slug ? `${base}/a/${art.slug}/` : base;
  return { title, url, workspaceId: art?.workspace_id ?? undefined };
}

// Telegram twins of the emails, in the recipient's language.
const TG = {
  en: {
    assigned: (from: string, title: string, due: string | null) => `${from} assigned you an action item on "${title}"${due ? ` (due ${due})` : ''}`,
    mention: (from: string, title: string) => `${from} mentioned you in a comment on "${title}"`,
    reply: (from: string, title: string) => `${from} replied to your comment on "${title}"`,
    resolved: (from: string, title: string) => `${from} marked your action item done on "${title}"`,
  },
  es: {
    assigned: (from: string, title: string, due: string | null) => `${from} te asignó una tarea en "${title}"${due ? ` (para el ${due})` : ''}`,
    mention: (from: string, title: string) => `${from} te mencionó en un comentario en "${title}"`,
    reply: (from: string, title: string) => `${from} respondió tu comentario en "${title}"`,
    resolved: (from: string, title: string) => `${from} terminó la tarea que asignaste en "${title}"`,
  },
};

function dueLabel(dueAt: string | null | undefined, locale: Locale): string | null {
  return dueAt ? new Date(dueAt).toLocaleDateString(localeTag(locale), { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : null;
}

function snippetOf(content: string): string {
  return content.length > SNIPPET_MAX ? content.slice(0, SNIPPET_MAX) + '…' : content;
}

/**
 * Notify the people a comment reaches: anyone @mentioned (mentions are stored as
 * email addresses by the overlay) and, for a reply, the parent comment's author.
 * Best-effort across email + the recipient's linked Telegram; never throws.
 */
export async function notifyCommentTargets(ctx: DataContext, comment: NotifyComment): Promise<void> {
  const db = ctx.env.DB;

  // The author's own email — never notify someone about their own comment.
  let authorEmail: string | null = null;
  if (comment.authorId) {
    const a = await db.prepare('SELECT email FROM users WHERE id = ?')
      .bind(comment.authorId).first<{ email: string }>();
    authorEmail = a?.email?.toLowerCase() ?? null;
  }

  // De-dupe by email; precedence: assigned > mention > reply.
  const byEmail = new Map<string, Recipient>();

  const assigneeEmail = (comment.assigneeEmail || '').trim().toLowerCase();
  if (assigneeEmail && assigneeEmail.includes('@') && assigneeEmail !== authorEmail) {
    const u = await db.prepare('SELECT id, email, name FROM users WHERE lower(email) = ?')
      .bind(assigneeEmail).first<{ id: string; email: string; name: string | null }>();
    byEmail.set(assigneeEmail, { userId: u?.id ?? null, email: u?.email ?? assigneeEmail, name: u?.name ?? null, reason: 'assigned' });
  }

  // `mentions` is free-form client input on a comment anyone may be able to post
  // (identityMode 'anonymous' needs no session). Notifying it verbatim turns the
  // instance into an open relay: arbitrary address, attacker-chosen author name and
  // body. Only people already ON the artifact — the same set assignees resolve
  // against — are notifiable. Unknown mentions still store and render; they just
  // don't generate mail.
  const claimedMentions = comment.mentions
    .map((m) => (m || '').trim().toLowerCase())
    .filter((m) => m.includes('@'));
  const notifiable = claimedMentions.length
    ? new Set((await listPeople(ctx)).map((p) => p.email.toLowerCase()))
    : new Set<string>();
  const mentionEmails = claimedMentions.filter((m) => notifiable.has(m));
  if (mentionEmails.length) {
    const placeholders = mentionEmails.map(() => '?').join(',');
    const rows = await db.prepare(
      `SELECT id, email, name FROM users WHERE lower(email) IN (${placeholders})`
    ).bind(...mentionEmails).all<{ id: string; email: string; name: string | null }>();
    const known = new Map(rows.results.map((r) => [r.email.toLowerCase(), r]));
    for (const email of mentionEmails) {
      if (email === authorEmail) continue;
      const u = known.get(email);
      byEmail.set(email, { userId: u?.id ?? null, email, name: u?.name ?? null, reason: 'mention' });
    }
  }

  if (comment.parentId) {
    const parent = await db.prepare(
      'SELECT author_id FROM artifact_comments WHERE artifact_id = ? AND id = ?'
    ).bind(ctx.artifactId, comment.parentId).first<{ author_id: string | null }>();
    if (parent?.author_id && parent.author_id !== comment.authorId) {
      const u = await db.prepare('SELECT id, email, name FROM users WHERE id = ?')
        .bind(parent.author_id).first<{ id: string; email: string; name: string | null }>();
      const email = u?.email?.toLowerCase();
      if (u && email && email !== authorEmail && !byEmail.has(email)) {
        byEmail.set(email, { userId: u.id, email: u.email, name: u.name, reason: 'reply' });
      }
    }
  }

  if (!byEmail.size) return;

  const { title, url, workspaceId } = await artifactMeta(ctx);
  const snippet = snippetOf(comment.content);
  const fromName = comment.authorName || 'Someone';
  const dueStr = dueLabel(comment.dueAt, 'en');
  const dueAt = comment.dueAt ?? null;

  const tasks: Promise<unknown>[] = [];
  for (const r of byEmail.values()) {
    if (r.reason === 'assigned') {
      tasks.push(
        dispatchLifecycleEmail(ctx.env, {
          type: 'action_item_assigned',
          toUserId: r.userId ?? undefined,
          toEmail: r.email,
          workspaceId,
          data: { fromName, title, snippet, url, dueStr, dueAt },
        }).catch(() => undefined),
      );
      if (r.userId) {
        const userId = r.userId;
        tasks.push((async () => {
          const chatId = await getLinkedChatId(ctx.env, userId);
          if (chatId != null) {
            const locale = await localeForRecipient(ctx.env, { userId, workspaceId });
            await sendMessage(ctx.env, chatId, `${t(locale, TG).assigned(fromName, title, dueLabel(dueAt, locale))}:\n\n"${snippet}"\n\n${url}`);
          }
        })().catch(() => undefined));
      }
      continue;
    }

    const verb = r.reason === 'mention' ? 'mentioned you in a comment' : 'replied to your comment';

    tasks.push(
      dispatchLifecycleEmail(ctx.env, {
        type: 'comment_notify',
        toUserId: r.userId ?? undefined,
        toEmail: r.email,
        workspaceId,
        data: { fromName, verb, title, snippet, url, reason: r.reason === 'mention' ? 'mention' : 'reply' },
      }).catch(() => undefined),
    );

    if (r.userId) {
      const userId = r.userId;
      tasks.push((async () => {
        const chatId = await getLinkedChatId(ctx.env, userId);
        if (chatId != null) {
          const locale = await localeForRecipient(ctx.env, { userId, workspaceId });
          const line = r.reason === 'mention' ? t(locale, TG).mention(fromName, title) : t(locale, TG).reply(fromName, title);
          await sendMessage(ctx.env, chatId, `${line}:\n\n"${snippet}"\n\n${url}`);
        }
      })().catch(() => undefined));
    }
  }
  await Promise.allSettled(tasks);
}

/**
 * Notify the person who assigned an action item that it was marked done, with a
 * deep link to reopen. Best-effort across email + linked Telegram; never throws.
 */
export async function notifyActionItemResolved(
  ctx: DataContext,
  requester: { userId: string | null; email: string },
  resolverName: string,
  content: string,
): Promise<void> {
  const { title, url, workspaceId } = await artifactMeta(ctx);
  const snippet = snippetOf(content);
  const fromName = resolverName || 'Someone';

  const tasks: Promise<unknown>[] = [
    dispatchLifecycleEmail(ctx.env, {
      type: 'action_item_resolved',
      toUserId: requester.userId ?? undefined,
      toEmail: requester.email,
      workspaceId,
      data: { fromName, title, snippet, url },
    }).catch(() => undefined),
  ];

  if (requester.userId) {
    const userId = requester.userId;
    tasks.push((async () => {
      const chatId = await getLinkedChatId(ctx.env, userId);
      if (chatId != null) {
        const locale = await localeForRecipient(ctx.env, { userId, workspaceId });
        await sendMessage(ctx.env, chatId, `${t(locale, TG).resolved(fromName, title)}:\n\n"${snippet}"\n\n${url}`);
      }
    })().catch(() => undefined));
  }

  await Promise.allSettled(tasks);
}

/** Fire the action-item-resolved notice past the response when possible; never blocks. */
export function dispatchActionItemResolved(
  ctx: DataContext,
  requester: { userId: string | null; email: string },
  resolverName: string,
  content: string,
): void {
  const p = notifyActionItemResolved(ctx, requester, resolverName, content).catch(() => undefined);
  if (ctx.waitUntil) ctx.waitUntil(p);
}

/** Fire comment notifications past the response when possible; never blocks the caller. */
export function dispatchCommentNotify(ctx: DataContext, comment: NotifyComment): void {
  const p = notifyCommentTargets(ctx, comment).catch(() => undefined);
  if (ctx.waitUntil) ctx.waitUntil(p);
}
