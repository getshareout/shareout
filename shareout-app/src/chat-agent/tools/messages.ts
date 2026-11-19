/**
 * Direct messages from the assistant (web Home, Telegram and every chat surface that shares these
 * tools). send_message proposes; nothing is sent until the person taps confirm, and the message
 * then goes out as theirs, marked as written through their assistant. read_messages reads their
 * own conversations. Same rules as the Messages menu (src/messages/store.ts).
 */
import type { AccountTool, ToolContext } from './types';
import type { PendingAction } from '../actions';
import { scopedWorkspaceId } from '../scope';
import { resolveArtifactAccessForUser } from '../access';
import {
  MESSAGE_MAX_CHARS, findThread, listThreads, markThreadRead, messagesToRead, resolveRecipient,
} from '../../messages/store';
import { conversationUrl } from '../../messages/notify';

const NO_WORKSPACE = 'Messages are between people in a workspace. Pick a workspace first, then ask again.';

const personLabel = (p: { name: string | null; email: string | null }) =>
  p.name && p.email ? `${p.name} (${p.email})` : p.name || p.email || 'someone';

async function workspaceOf(ctx: ToolContext): Promise<string | null> {
  return scopedWorkspaceId(ctx);
}

export const sendMessageTool: AccountTool = {
  name: 'send_message',
  description:
    'Send a direct message to another member of the current workspace, as the user (it shows as written through their assistant). '
    + '`to` is the person’s name or email exactly as the user said it. Write the text the user asked for, in their words and language; '
    + 'optional artifact_id points the message at a page. Shows the user the recipient and the exact text to confirm before anything is sent. '
    + 'If more than one person matches, ask the user which one.',
  input_schema: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Name or email of the workspace member.' },
      text: { type: 'string', description: `The message, at most ${MESSAGE_MAX_CHARS} characters.` },
      artifact_id: { type: 'string', description: 'Optional: a page the message is about (art_…).' },
    },
    required: ['to', 'text'],
  },
  async execute(ctx, input): Promise<{ __propose: PendingAction } | { error: string }> {
    const wsId = await workspaceOf(ctx);
    if (!wsId) return { error: NO_WORKSPACE };
    const text = typeof input.text === 'string' ? input.text.trim() : '';
    if (!text) return { error: 'What should the message say?' };
    if (text.length > MESSAGE_MAX_CHARS) return { error: `That is too long — keep it under ${MESSAGE_MAX_CHARS} characters.` };
    const who = await resolveRecipient(ctx.env, wsId, ctx.userId, typeof input.to === 'string' ? input.to : '');
    if (!who.ok) {
      if (who.candidates?.length) return { error: `${who.message} Options: ${who.candidates.map(personLabel).join('; ')}` };
      return { error: who.message };
    }
    let artifactName: string | undefined;
    const artifactId = typeof input.artifact_id === 'string' && input.artifact_id ? input.artifact_id : undefined;
    if (artifactId) {
      const access = await resolveArtifactAccessForUser(ctx.env, artifactId, ctx.userId);
      const row = access && access.workspaceId === wsId
        ? await ctx.env.DB.prepare('SELECT name FROM artifacts WHERE id = ? AND deleted_at IS NULL').bind(artifactId).first<{ name: string }>()
        : null;
      if (!row) return { error: 'I could not find that page in this workspace.' };
      artifactName = row.name;
    }
    return {
      __propose: {
        kind: 'message_send',
        workspaceId: wsId,
        recipientId: who.person.id,
        recipientName: personLabel(who.person),
        text,
        ...(artifactId ? { artifactId, artifactName } : {}),
      },
    };
  },
};

export const readMessagesTool: AccountTool = {
  name: 'read_messages',
  description:
    'Read the user’s direct messages in the current workspace. Without `with`: their conversations, unread first, with the last message of each. '
    + 'With `with` (a name or email): the unread messages with that person from the oldest (the latest ones when nothing is unread), oldest first, marked read up to the last one shown; more_unread says how many are left. Use it for “did anyone write to me?” or “what did Ana say?”.',
  input_schema: {
    type: 'object',
    properties: {
      with: { type: 'string', description: 'Optional: name or email of the other person.' },
      unread_only: { type: 'boolean', description: 'Only conversations with unread messages (when `with` is not given).' },
    },
  },
  async execute(ctx, input) {
    const wsId = await workspaceOf(ctx);
    if (!wsId) return { error: NO_WORKSPACE };
    if (typeof input.with === 'string' && input.with.trim()) {
      const who = await resolveRecipient(ctx.env, wsId, ctx.userId, input.with);
      if (!who.ok) {
        if (who.candidates?.length) return { error: `${who.message} Options: ${who.candidates.map(personLabel).join('; ')}` };
        return { error: who.message };
      }
      const thread = await findThread(ctx.env, wsId, ctx.userId, { withUserId: who.person.id });
      const link = await conversationUrl(ctx.env, wsId, who.person.id);
      if (!thread) return { with: personLabel(who.person), messages: [], note: 'No messages with this person yet.', link };
      // Unread first, in order; read only up to the last one shown, so nothing unread is skipped.
      const { messages, moreUnread } = await messagesToRead(ctx.env, thread.id, ctx.userId, 20);
      if (messages.length) await markThreadRead(ctx.env, thread.id, ctx.userId, messages[messages.length - 1].createdAt);
      return {
        with: personLabel(who.person),
        link,
        ...(moreUnread ? { more_unread: moreUnread, note: `${moreUnread} more unread after these — read again to see them.` } : {}),
        messages: messages.map((m) => ({
          from: m.sentByMe ? 'you' : personLabel(who.person),
          text: m.body,
          ...(m.sentVia !== 'web' ? { through_assistant: true } : {}),
          ...(m.artifact ? { page: m.artifact.name } : {}),
          at: m.createdAt,
        })),
      };
    }
    const threads = await listThreads(ctx.env, wsId, ctx.userId, { limit: 20, unreadOnly: input.unread_only === true });
    threads.sort((a, b) => Number(b.unread > 0) - Number(a.unread > 0));
    return {
      conversations: threads.map((t) => ({
        with: personLabel(t.with),
        unread: t.unread,
        last: t.last ? { from: t.last.sentByMe ? 'you' : personLabel(t.with), text: t.last.body, at: t.last.at } : null,
      })),
      ...(threads.length ? {} : { note: input.unread_only === true ? 'No unread messages.' : 'No conversations yet.' }),
    };
  },
};
