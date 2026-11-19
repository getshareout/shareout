import type { Env } from '../types';
import { generateId } from '../crypto-utils';
import { getInternalWorkspaceRole } from '../workspaces/roles';
import { resolveArtifactAccessForUser } from '../chat-agent/access';

// Direct messages: one-to-one between two internal members of the same workspace (0048).
// Every surface — the Messages menu, the assistant (web, Telegram), MCP, the REST API — goes
// through these functions, so the rules live in one place: both people internal members of the
// workspace, neither a service account nor disabled, never to yourself.

export type SentVia = 'web' | 'api' | 'mcp' | 'assistant';
export const SENT_VIA: readonly SentVia[] = ['web', 'api', 'mcp', 'assistant'];
export const MESSAGE_MAX_CHARS = 4000;
const PREVIEW_CHARS = 140;

export interface MessagePerson { id: string; name: string | null; email: string | null; picture: string | null }

export interface MessageView {
  id: string;
  body: string;
  sentByMe: boolean;
  senderId: string | null;
  sentVia: SentVia;
  artifact: { id: string; name: string; slug: string | null } | null;
  createdAt: string;
}

export interface ThreadSummary {
  id: string;
  with: MessagePerson;
  last: { body: string; sentByMe: boolean; sentVia: SentVia; at: string } | null;
  unread: number;
  lastMessageAt: string;
}

export interface MessageError { ok: false; status: number; code: string; message: string; candidates?: MessagePerson[] }

const fail = (status: number, code: string, message: string, extra: Partial<MessageError> = {}): MessageError =>
  ({ ok: false, status, code, message, ...extra });

export const pairKey = (a: string, b: string): string => (a < b ? `${a}:${b}` : `${b}:${a}`);

const PERSON_COLS = 'u.id AS id, u.name AS name, u.email AS email, u.picture AS picture';
// Internal, enabled, human members only: the people a message can go to or come from.
const MESSAGEABLE = `JOIN workspace_members wm ON wm.user_id = u.id
  WHERE wm.workspace_id = ? AND wm.member_class = 'internal'
    AND COALESCE(u.disabled, 0) = 0 AND COALESCE(u.is_service, 0) = 0`;

async function isMessageable(env: Env, workspaceId: string, userId: string): Promise<boolean> {
  const row = await env.DB.prepare(`SELECT 1 FROM users u ${MESSAGEABLE} AND u.id = ? LIMIT 1`)
    .bind(workspaceId, userId).first();
  return !!row;
}

/** Everyone the user can write to in this workspace, by name. */
export async function listMessageablePeople(env: Env, workspaceId: string, userId: string): Promise<MessagePerson[]> {
  const { results } = await env.DB.prepare(
    `SELECT ${PERSON_COLS} FROM users u ${MESSAGEABLE} AND u.id != ?
      ORDER BY COALESCE(u.name, u.email) COLLATE NOCASE LIMIT 500`,
  ).bind(workspaceId, userId).all<MessagePerson>();
  return results || [];
}

/** Who "to" means: a user id, an email, or a name ("Martín", "martin g"). A name that matches
 *  more than one person returns them as candidates so the caller can ask which one. */
export async function resolveRecipient(
  env: Env, workspaceId: string, senderId: string, to: string,
): Promise<{ ok: true; person: MessagePerson } | MessageError> {
  const q = (to || '').trim();
  if (!q) return fail(400, 'RECIPIENT_REQUIRED', 'Say who the message is for (their name or email).');
  const people = await listMessageablePeople(env, workspaceId, senderId);
  const lower = q.toLowerCase().replace(/^@/, '');
  const exact = people.find((p) => p.id === q || (p.email || '').toLowerCase() === lower);
  if (exact) return { ok: true, person: exact };
  const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const needle = fold(lower);
  const byName = people.filter((p) => {
    const name = fold(p.name || '');
    const local = fold((p.email || '').split('@')[0]);
    return name === needle || local === needle
      || needle.split(/\s+/).every((w) => w && name.split(/\s+/).some((n) => n.startsWith(w)));
  });
  if (byName.length === 1) return { ok: true, person: byName[0] };
  // "Martín Gómez" picks Martín Gómez even when Martín Gómez Pérez also matches.
  const exactName = byName.filter((p) => fold(p.name || '') === needle);
  if (exactName.length === 1) return { ok: true, person: exactName[0] };
  if (byName.length > 1) {
    return fail(409, 'RECIPIENT_AMBIGUOUS', `More than one person matches "${q}". Say which one.`, { candidates: byName.slice(0, 8) });
  }
  if (lower === (await selfEmail(env, senderId))) return fail(400, 'RECIPIENT_IS_SELF', 'You cannot send a message to yourself.');
  return fail(404, 'RECIPIENT_NOT_FOUND', `Nobody in this workspace matches "${q}". Messages go to members of the workspace only.`);
}

async function selfEmail(env: Env, userId: string): Promise<string> {
  const row = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(userId).first<{ email: string | null }>();
  return (row?.email || '').toLowerCase();
}

export interface SendInput {
  workspaceId: string;
  senderId: string;
  recipientId: string;
  body: string;
  artifactId?: string | null;
  via: SentVia;
}

export interface SendOk { ok: true; threadId: string; message: MessageView; recipient: MessagePerson }

/** Validate and store one message. Telling the recipient is the caller's next step
 *  (notify.ts), so a surface can defer it past the response. */
export async function sendDirectMessage(env: Env, input: SendInput): Promise<SendOk | MessageError> {
  const body = (input.body || '').trim();
  if (!body) return fail(400, 'MESSAGE_EMPTY', 'Write something to send.');
  if (body.length > MESSAGE_MAX_CHARS) return fail(400, 'MESSAGE_TOO_LONG', `Keep it under ${MESSAGE_MAX_CHARS} characters.`);
  if (!SENT_VIA.includes(input.via)) return fail(400, 'VALIDATION_ERROR', 'Unknown sent_via.');
  if (input.recipientId === input.senderId) return fail(400, 'RECIPIENT_IS_SELF', 'You cannot send a message to yourself.');

  // Not a member: stay vague, as requireWorkspaceRole does (don't confirm the workspace exists).
  if (!(await getInternalWorkspaceRole(env, input.workspaceId, input.senderId))
    || !(await isMessageable(env, input.workspaceId, input.senderId))) {
    return fail(403, 'FORBIDDEN', 'Forbidden');
  }
  const recipient = await env.DB.prepare(`SELECT ${PERSON_COLS} FROM users u ${MESSAGEABLE} AND u.id = ? LIMIT 1`)
    .bind(input.workspaceId, input.recipientId).first<MessagePerson>();
  if (!recipient) return fail(404, 'RECIPIENT_NOT_FOUND', 'That person is not a member of this workspace.');

  let artifact: MessageView['artifact'] = null;
  if (input.artifactId) {
    // Only a page in this workspace that the sender can open: a message must not reveal the name
    // of a page its sender could not see.
    const access = await resolveArtifactAccessForUser(env, input.artifactId, input.senderId);
    const row = access && access.workspaceId === input.workspaceId
      ? await env.DB.prepare('SELECT id, name, slug FROM artifacts WHERE id = ? AND deleted_at IS NULL')
        .bind(input.artifactId).first<{ id: string; name: string; slug: string | null }>()
      : null;
    if (!row) return fail(404, 'ARTIFACT_NOT_FOUND', 'That page was not found in this workspace.');
    artifact = row;
  }

  const now = new Date().toISOString();
  const key = pairKey(input.senderId, input.recipientId);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO direct_message_threads (id, workspace_id, pair_key, created_by, last_message_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(generateId('dmt'), input.workspaceId, key, input.senderId, now, now).run();
  const thread = await env.DB.prepare('SELECT id FROM direct_message_threads WHERE workspace_id = ? AND pair_key = ?')
    .bind(input.workspaceId, key).first<{ id: string }>();
  if (!thread) return fail(500, 'INTERNAL_ERROR', 'Could not open the conversation. Try again.');

  const id = generateId('dm');
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO direct_message_members (thread_id, user_id) VALUES (?, ?), (?, ?)')
      .bind(thread.id, input.senderId, thread.id, input.recipientId),
    env.DB.prepare(
      `INSERT INTO direct_messages (id, thread_id, sent_by, body, artifact_id, sent_via, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, thread.id, input.senderId, body, artifact?.id ?? null, input.via, now),
    // The sender's read state is left alone: a send from the assistant, MCP or the API must not
    // mark as read what the other person wrote and the sender never saw. Their own messages never
    // count as unread; opening the conversation (markThreadRead) is what reads it.
    env.DB.prepare('UPDATE direct_message_threads SET last_message_at = ? WHERE id = ?').bind(now, thread.id),
  ]);

  return {
    ok: true,
    threadId: thread.id,
    recipient,
    message: { id, body, sentByMe: true, senderId: input.senderId, sentVia: input.via, artifact, createdAt: now },
  };
}

interface ThreadRow {
  id: string; last_message_at: string; last_read_at: string | null;
  other_id: string; other_name: string | null; other_email: string | null; other_picture: string | null;
  last_body: string | null; last_sent_by: string | null; last_via: SentVia | null; last_at: string | null;
  unread: number;
}

/** The user's conversations in this workspace, most recent first, with unread counts. */
export async function listThreads(
  env: Env, workspaceId: string, userId: string, opts: { limit?: number; unreadOnly?: boolean } = {},
): Promise<ThreadSummary[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.last_message_at, me.last_read_at,
            u.id AS other_id, u.name AS other_name, u.email AS other_email, u.picture AS other_picture,
            lm.body AS last_body, lm.sent_by AS last_sent_by, lm.sent_via AS last_via, lm.created_at AS last_at,
            (SELECT COUNT(*) FROM direct_messages m
              WHERE m.thread_id = t.id AND (m.sent_by IS NULL OR m.sent_by != ?)
                AND (me.last_read_at IS NULL OR m.created_at > me.last_read_at)) AS unread
       FROM direct_message_threads t
       JOIN direct_message_members me ON me.thread_id = t.id AND me.user_id = ?
       JOIN direct_message_members other ON other.thread_id = t.id AND other.user_id != ?
       JOIN users u ON u.id = other.user_id
       LEFT JOIN direct_messages lm ON lm.id = (
         SELECT id FROM direct_messages WHERE thread_id = t.id ORDER BY created_at DESC, rowid DESC LIMIT 1)
      WHERE t.workspace_id = ?
      ORDER BY t.last_message_at DESC LIMIT ?`,
  ).bind(userId, userId, userId, workspaceId, limit).all<ThreadRow>();
  return (results || [])
    .filter((r) => !opts.unreadOnly || r.unread > 0)
    .map((r) => ({
      id: r.id,
      with: { id: r.other_id, name: r.other_name, email: r.other_email, picture: r.other_picture },
      last: r.last_at ? {
        body: (r.last_body || '').slice(0, PREVIEW_CHARS),
        sentByMe: r.last_sent_by === userId,
        sentVia: (r.last_via || 'web') as SentVia,
        at: r.last_at,
      } : null,
      unread: Number(r.unread) || 0,
      lastMessageAt: r.last_message_at,
    }));
}

/** Total unread messages for the user in this workspace (the badge). */
export async function unreadCount(env: Env, workspaceId: string, userId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n
       FROM direct_messages m
       JOIN direct_message_threads t ON t.id = m.thread_id AND t.workspace_id = ?
       JOIN direct_message_members me ON me.thread_id = t.id AND me.user_id = ?
      WHERE (m.sent_by IS NULL OR m.sent_by != ?)
        AND (me.last_read_at IS NULL OR m.created_at > me.last_read_at)`,
  ).bind(workspaceId, userId, userId).first<{ n: number }>();
  return Number(row?.n) || 0;
}

/** A conversation the user is in, by its id or by the other person's id. null when the user is
 *  not in it (or it does not exist) — callers answer 404 either way. */
export async function findThread(
  env: Env, workspaceId: string, userId: string, ref: { threadId?: string; withUserId?: string },
): Promise<{ id: string; with: MessagePerson } | null> {
  const where = ref.threadId ? 't.id = ?' : 't.pair_key = ?';
  const bindRef = ref.threadId ?? pairKey(userId, ref.withUserId || '');
  const row = await env.DB.prepare(
    `SELECT t.id AS thread_id, ${PERSON_COLS}
       FROM direct_message_threads t
       JOIN direct_message_members me ON me.thread_id = t.id AND me.user_id = ?
       JOIN direct_message_members other ON other.thread_id = t.id AND other.user_id != ?
       JOIN users u ON u.id = other.user_id
      WHERE t.workspace_id = ? AND ${where} LIMIT 1`,
  ).bind(userId, userId, workspaceId, bindRef).first<{ thread_id: string } & MessagePerson>();
  if (!row) return null;
  return { id: row.thread_id, with: { id: row.id, name: row.name, email: row.email, picture: row.picture } };
}

interface MessageRow {
  id: string; body: string; sent_by: string | null; sent_via: SentVia; created_at: string;
  artifact_id: string | null; artifact_name: string | null; artifact_slug: string | null;
}

/** Messages in one conversation, newest first (`before` pages back by created_at). */
export async function listMessages(
  env: Env, threadId: string, userId: string, opts: { limit?: number; before?: string } = {},
): Promise<MessageView[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const { results } = await env.DB.prepare(
    `SELECT m.id, m.body, m.sent_by, m.sent_via, m.created_at,
            a.id AS artifact_id, a.name AS artifact_name, a.slug AS artifact_slug
       FROM direct_messages m
       LEFT JOIN artifacts a ON a.id = m.artifact_id AND a.deleted_at IS NULL
      WHERE m.thread_id = ? ${opts.before ? 'AND m.created_at < ?' : ''}
      ORDER BY m.created_at DESC, m.rowid DESC LIMIT ?`,
  ).bind(...(opts.before ? [threadId, opts.before, limit] : [threadId, limit])).all<MessageRow>();
  return (results || []).map((r) => ({
    id: r.id,
    body: r.body,
    sentByMe: r.sent_by === userId,
    senderId: r.sent_by,
    sentVia: r.sent_via,
    artifact: r.artifact_id ? { id: r.artifact_id, name: r.artifact_name || '', slug: r.artifact_slug } : null,
    createdAt: r.created_at,
  }));
}

export async function markThreadRead(env: Env, threadId: string, userId: string): Promise<void> {
  await env.DB.prepare('UPDATE direct_message_members SET last_read_at = ? WHERE thread_id = ? AND user_id = ?')
    .bind(new Date().toISOString(), threadId, userId).run();
}
