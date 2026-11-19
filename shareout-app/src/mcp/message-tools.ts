/**
 * Direct messages over MCP: the person's own AI (Claude, ChatGPT…) sends and reads their messages
 * with workspace members. send_message is two steps, like the confirm button in ShareOut's own
 * assistant: the first call stores the draft (direct_message_drafts) and returns its id as the
 * confirm_token; the message goes out when the same draft comes back with that token, after the
 * person said yes. The confirming call deletes the draft and sends what it holds, so a token sends
 * once, only for the person it was drafted for, within 10 minutes. A token that does not match the
 * draft exactly is spent too: the next try starts from a new draft.
 */
import {
  NOT_MEMBER, fail, invalid, ok, resolveWorkspace, str, workspaceChoiceText,
  type Args, type ToolContext, type ToolDef, type ToolResult,
} from './tool-kit';
import type { BotWorkspace } from '../chat-agent/access';
import { resolveArtifactAccessForUser } from '../chat-agent/access';
import {
  MESSAGE_MAX_CHARS, findThread, listMessages, listThreads, markThreadRead, resolveRecipient,
  type MessageError, type MessagePerson,
} from '../messages/store';
import { sendAndNotify } from '../messages/send';
import { generateId } from '../crypto-utils';
import { conversationUrl } from '../messages/notify';

const DRAFT_MS = 10 * 60 * 1000;

const personLabel = (p: MessagePerson) => (p.name && p.email ? `${p.name} (${p.email})` : p.name || p.email || 'someone');

async function pickWorkspace(ctx: ToolContext, args: Args): Promise<BotWorkspace | ToolResult> {
  const resolved = await resolveWorkspace(ctx, str(args.workspace_id, 100));
  if (resolved.notMember) return invalid(NOT_MEMBER);
  if (resolved.choices) return ok(workspaceChoiceText('message someone', resolved.choices), { needs_workspace: true, workspaces: resolved.choices });
  if (!resolved.workspace) return invalid('The person has no workspace yet, so there is nobody to message.');
  return resolved.workspace;
}

const isResult = (v: BotWorkspace | ToolResult): v is ToolResult => 'content' in v;

function recipientProblem(e: MessageError): ToolResult {
  if (e.candidates?.length) {
    return invalid(`${e.message} Ask the person which one: ${e.candidates.map(personLabel).join('; ')}.`, {
      candidates: e.candidates.map((c) => ({ name: c.name, email: c.email })),
    });
  }
  return invalid(e.message);
}

const sendMessage: ToolDef = {
  name: 'send_message',
  title: 'Send a message to someone in the workspace',
  description: [
    'Sends a direct message, as the person, to another member of their ShareOut workspace; it shows as written through their assistant, and the recipient sees it in ShareOut (and on Telegram when linked).',
    'Two steps: a call without confirm_token sends nothing and returns the draft and a confirm_token; the same to, text and artifact_id with that token sends it. A token works once, for 10 minutes; a token that does not match the draft is spent and sends nothing.',
    'to: a name or email; when several people match, the candidates come back instead. text: at most 4000 characters. artifact_id: optional page the message is about.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      workspace_id: { type: 'string', description: 'Needed when the person has more than one workspace.' },
      to: { type: 'string', description: 'Name or email of the workspace member.' },
      text: { type: 'string', description: 'The message.' },
      artifact_id: { type: 'string', description: 'Optional: a page the message is about (art_…).' },
      confirm_token: { type: 'string', description: 'From the first call, after the person confirmed the draft.' },
    },
    required: ['to', 'text'],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async run(ctx, args) {
    const ws = await pickWorkspace(ctx, args);
    if (isResult(ws)) return ws;
    const text = typeof args.text === 'string' ? args.text.trim() : '';
    if (!text) return invalid('Nothing was sent: the message is empty.');
    if (text.length > MESSAGE_MAX_CHARS) return invalid(`Nothing was sent: keep the message under ${MESSAGE_MAX_CHARS} characters.`);
    const who = await resolveRecipient(ctx.env, ws.id, ctx.user.id, str(args.to, 320) || '');
    if (!who.ok) return recipientProblem(who);

    const artifactId = str(args.artifact_id, 100);
    let artifactName: string | null = null;
    if (artifactId) {
      const access = await resolveArtifactAccessForUser(ctx.env, artifactId, ctx.user.id);
      const row = access && access.workspaceId === ws.id
        ? await ctx.env.DB.prepare('SELECT name FROM artifacts WHERE id = ? AND deleted_at IS NULL').bind(artifactId).first<{ name: string }>()
        : null;
      if (!row) return invalid('Nothing was sent: that page is not in this workspace or the person cannot open it.');
      artifactName = row.name;
    }

    const given = str(args.confirm_token, 100);
    if (!given) {
      const now = Date.now();
      const token = generateId('dmd');
      await ctx.env.DB.batch([
        // Drafts nobody confirmed go when the same person drafts again.
        ctx.env.DB.prepare('DELETE FROM direct_message_drafts WHERE sent_by = ? AND expires_at < ?').bind(ctx.user.id, new Date(now).toISOString()),
        ctx.env.DB.prepare(
          `INSERT INTO direct_message_drafts (id, workspace_id, sent_by, recipient_id, body, artifact_id, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ).bind(token, ws.id, ctx.user.id, who.person.id, text, artifactId, new Date(now + DRAFT_MS).toISOString()),
      ]);
      const about = artifactName ? `\nAbout: "${artifactName}"` : '';
      return ok(
        `Nothing sent yet. Show the person this draft and ask them to confirm:\nTo: ${personLabel(who.person)}\nText: "${text}"${about}\n`
        + 'When they say yes, call send_message again with the same to, text and artifact_id and this confirm_token. It works once, for 10 minutes.',
        { draft: { to: personLabel(who.person), text, ...(artifactName ? { page: artifactName } : {}) }, confirm_token: token, sent: false },
      );
    }
    // Spend the token whatever happens next: one draft, one send, only by the person it is for.
    const draft = await ctx.env.DB.prepare(
      `DELETE FROM direct_message_drafts WHERE id = ? AND sent_by = ?
       RETURNING workspace_id, recipient_id, body, artifact_id, expires_at`,
    ).bind(given, ctx.user.id).first<{ workspace_id: string; recipient_id: string; body: string; artifact_id: string | null; expires_at: string }>();
    const matches = !!draft && draft.expires_at > new Date().toISOString() && draft.workspace_id === ws.id
      && draft.recipient_id === who.person.id && draft.body === text && (draft.artifact_id ?? null) === (artifactId ?? null);
    if (!matches) {
      return invalid('Nothing was sent: this confirm_token was already used, expired, or does not match this exact draft. Call send_message without confirm_token for a new draft, and confirm it with the person.');
    }

    const sent = await sendAndNotify(ctx.env, {
      workspaceId: ws.id, senderId: ctx.user.id, recipientId: who.person.id, body: text, artifactId, via: 'mcp',
    }, ctx.executionCtx ? (p) => ctx.executionCtx!.waitUntil(p) : undefined);
    if (!sent.ok) return sent.status >= 500 ? fail(`Nothing was sent: ${sent.message}`) : invalid(`Nothing was sent: ${sent.message}`);
    const link = await conversationUrl(ctx.env, ws.id, who.person.id);
    return ok(`Sent to ${personLabel(who.person)}. The conversation: ${link}`, { sent: true, message_id: sent.message.id, to: personLabel(who.person), link });
  },
};

const readMessages: ToolDef = {
  name: 'read_messages',
  title: 'Read your messages',
  description: [
    'Reads the person\'s direct messages in their ShareOut workspace.',
    'Without `with`: their conversations, unread first, with the last message of each. With `with` (a name or email): recent messages with that person, oldest first, which are then marked read.',
    'Replies go through send_message.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      workspace_id: { type: 'string', description: 'Needed when the person has more than one workspace.' },
      with: { type: 'string', description: 'Optional: name or email of the other person.' },
      unread_only: { type: 'boolean', description: 'Only conversations with unread messages.' },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async run(ctx, args) {
    const ws = await pickWorkspace(ctx, args);
    if (isResult(ws)) return ws;
    const withWho = str(args.with, 320);
    if (withWho) {
      const who = await resolveRecipient(ctx.env, ws.id, ctx.user.id, withWho);
      if (!who.ok) return recipientProblem(who);
      const link = await conversationUrl(ctx.env, ws.id, who.person.id);
      const thread = await findThread(ctx.env, ws.id, ctx.user.id, { withUserId: who.person.id });
      if (!thread) return ok(`No messages with ${personLabel(who.person)} yet.`, { with: personLabel(who.person), messages: [], link });
      const messages = (await listMessages(ctx.env, thread.id, ctx.user.id, { limit: 20 })).reverse();
      await markThreadRead(ctx.env, thread.id, ctx.user.id);
      const rows = messages.map((m) => ({
        from: m.sentByMe ? 'you' : personLabel(who.person),
        text: m.body,
        ...(m.sentVia !== 'web' ? { through_assistant: true } : {}),
        ...(m.artifact ? { page: m.artifact.name } : {}),
        at: m.createdAt,
      }));
      const lines = rows.map((r) => `${r.at.slice(0, 16).replace('T', ' ')} ${r.from}: ${r.text}`).join('\n');
      return ok(`Messages with ${personLabel(who.person)} (oldest first):\n${lines}\n\nOpen in ShareOut: ${link}`, { with: personLabel(who.person), messages: rows, link });
    }
    const threads = await listThreads(ctx.env, ws.id, ctx.user.id, { limit: 20, unreadOnly: args.unread_only === true });
    threads.sort((a, b) => Number(b.unread > 0) - Number(a.unread > 0));
    if (!threads.length) return ok(args.unread_only === true ? 'No unread messages.' : 'No conversations yet.', { conversations: [] });
    const rows = threads.map((t) => ({
      with: personLabel(t.with),
      unread: t.unread,
      last: t.last ? { from: t.last.sentByMe ? 'you' : personLabel(t.with), text: t.last.body, at: t.last.at } : null,
    }));
    const lines = rows.map((r) => `- ${r.with}${r.unread ? ` (${r.unread} unread)` : ''}${r.last ? `: ${r.last.from}: ${r.last.text}` : ''}`).join('\n');
    return ok(`Conversations in "${ws.name}":\n${lines}`, { conversations: rows });
  },
};

export const MESSAGE_TOOLS: ToolDef[] = [sendMessage, readMessages];
