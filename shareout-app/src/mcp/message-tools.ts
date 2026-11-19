/**
 * Direct messages over MCP: the person's own AI (Claude, ChatGPT…) sends and reads their messages
 * with workspace members. send_message is two steps, like the confirm button in ShareOut's own
 * assistant: the first call only returns the draft and a confirm_token; the message goes out when
 * the same draft comes back with that token, after the person said yes. The token is bound to the
 * person, workspace, recipient, page and exact text, and lasts about 10 minutes.
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
import { conversationUrl } from '../messages/notify';

const WINDOW_MS = 10 * 60 * 1000;

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

/** HMAC over the exact draft, per 10-minute window (the current and the previous one are accepted). */
export async function confirmToken(secret: string, parts: string[], window: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(['dm-confirm', window, ...parts].join('\u0000')));
  return [...new Uint8Array(sig)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const sendMessage: ToolDef = {
  name: 'send_message',
  title: 'Send a message to someone in the workspace',
  description: [
    'Sends a direct message, as the person, to another member of their ShareOut workspace; it shows as written through their assistant, and the recipient sees it in ShareOut (and on Telegram when linked).',
    'Two steps: a call without confirm_token sends nothing and returns the draft and a confirm_token; the same to, text and artifact_id with that token sends it (the token lasts about 10 minutes).',
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

    const parts = [ctx.user.id, ws.id, who.person.id, artifactId || '', text];
    const now = Math.floor(Date.now() / WINDOW_MS);
    const given = str(args.confirm_token, 100);
    if (!given) {
      const token = await confirmToken(ctx.env.SESSION_SECRET, parts, now);
      const about = artifactName ? `\nAbout: "${artifactName}"` : '';
      return ok(
        `Nothing sent yet. Show the person this draft and ask them to confirm:\nTo: ${personLabel(who.person)}\nText: "${text}"${about}\n`
        + 'When they say yes, call send_message again with the same to, text and artifact_id and this confirm_token.',
        { draft: { to: personLabel(who.person), text, ...(artifactName ? { page: artifactName } : {}) }, confirm_token: token, sent: false },
      );
    }
    const current = await confirmToken(ctx.env.SESSION_SECRET, parts, now);
    const previous = await confirmToken(ctx.env.SESSION_SECRET, parts, now - 1);
    if (!safeEqual(given, current) && !safeEqual(given, previous)) {
      return invalid('Nothing was sent: the confirm_token does not match this exact draft (or it expired). Call send_message without confirm_token to get a new draft, and confirm it with the person.');
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
