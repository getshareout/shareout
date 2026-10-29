/**
 * One path for the review and sharing notifications: a feed row on the recipient's Home
 * (optional), the catalog email (optional), and their linked Telegram. Preferences: the email
 * gateway enforces the 'product' opt-out, the suppression list and the unsubscribe
 * header; Telegram follows the same opt-out, so unsubscribing silences both. The actor
 * is never a recipient (callers pass `actorIds`). Best-effort; never throws.
 */
import type { Env } from '../types';
import type { Locale } from '../i18n';
import { dispatchLifecycleEmail, type EmailType } from '../email/gateway';
import { isCategoryAllowed } from '../email/preferences';
import { getLinkedChatId } from '../telegram/linking';
import { sendMessage } from '../telegram/client';
import { localeForRecipient } from '../i18n/locale';
import { generateId } from '../crypto-utils';

export const NOTIFY_KINDS = ['version_approved', 'folder_first_open', 'version_published', 'page_build'] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number];

export interface NotifyInput {
  userId: string;
  /** Who caused it. A recipient in this list is skipped. */
  actorIds: string[];
  /** Absent: no email (a feed-only notice, e.g. a page build that finished while you were away). */
  email?: { type: EmailType; data: Record<string, unknown> };
  telegram?: (locale: Locale) => string;
  feed?: { kind: NotifyKind; subjectType: string; subjectId: string; payload: Record<string, unknown> };
  workspaceId?: string | null;
}

export async function notifyUser(env: Env, input: NotifyInput): Promise<void> {
  if (input.actorIds.includes(input.userId)) return;
  try {
    if (input.feed) {
      await env.DB.prepare(
        `INSERT INTO notifications (id, recipient_type, recipient_id, kind, subject_type, subject_id, payload)
         VALUES (?, 'user', ?, ?, ?, ?, ?)`,
      ).bind(generateId('ntf'), input.userId, input.feed.kind, input.feed.subjectType, input.feed.subjectId, JSON.stringify(input.feed.payload)).run();
    }
    const tasks: Promise<unknown>[] = [];
    if (input.email) {
      tasks.push(dispatchLifecycleEmail(env, {
        type: input.email.type, toUserId: input.userId, workspaceId: input.workspaceId ?? undefined, data: input.email.data,
      }).catch(() => undefined));
    }
    if (input.telegram && env.TELEGRAM_BOT_TOKEN && (await isCategoryAllowed(env, input.userId, 'product'))) {
      const line = input.telegram;
      tasks.push((async () => {
        const chatId = await getLinkedChatId(env, input.userId);
        if (chatId == null) return;
        const locale = await localeForRecipient(env, { userId: input.userId, workspaceId: input.workspaceId });
        await sendMessage(env, chatId, line(locale));
      })().catch(() => undefined));
    }
    await Promise.allSettled(tasks);
  } catch { /* best-effort */ }
}

export interface ArtifactLink { title: string; url: string; slug: string | null; workspaceId: string | null; ownerId: string | null; visibility: string; folderId: string | null }

/** Name, live URL and access columns of an artifact; null when it is gone. */
export async function artifactLink(env: Env, base: string, artifactId: string): Promise<ArtifactLink | null> {
  const a = await env.DB.prepare(
    `SELECT a.name, a.workspace_id, a.owner_id, a.visibility, a.folder_id, d.slug
       FROM artifacts a LEFT JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
      WHERE a.id = ? AND a.deleted_at IS NULL`,
  ).bind(artifactId).first<{ name: string | null; workspace_id: string | null; owner_id: string | null; visibility: string; folder_id: string | null; slug: string | null }>();
  if (!a) return null;
  return {
    title: a.name?.trim() || 'an artifact',
    url: a.slug ? `${base}/a/${a.slug}/` : `${base}/home`,
    slug: a.slug, workspaceId: a.workspace_id, ownerId: a.owner_id, visibility: a.visibility, folderId: a.folder_id,
  };
}

export async function displayName(env: Env, userId: string | null | undefined): Promise<string> {
  if (!userId) return 'Someone';
  const u = await env.DB.prepare('SELECT name, email FROM users WHERE id = ?').bind(userId).first<{ name: string | null; email: string | null }>();
  return u?.name?.trim() || u?.email || 'Someone';
}
