import type { Env } from '../types';
import type { FetchContext } from './context';
import type { TelegramUpdate } from '../telegram/types';
import { sendMessage, sendMessageWithButtons, answerCallbackQuery, sendChatAction, type InlineButton } from '../telegram/client';
import { transcribeTelegramAudio } from '../telegram/voice';
import {
  consumeLinkCode,
  linkChat,
  getLinkedUserId,
  getSelectedTelegramWorkspace,
  setSelectedTelegramWorkspace,
  unlinkChat,
} from '../telegram/linking';
import { handleAccessRequestTelegramCallback } from '../artifacts/access-requests';
import { listArtifactsForUser } from '../chat-agent/tools/artifacts';
import {
  resolveArtifactAccessForUser,
  listWorkspacesForUser,
  TELEGRAM_PERSONAL_WORKSPACE,
  type TelegramWorkspace,
  type TelegramWorkspaceSelection,
} from '../chat-agent/access';
import { sendSnapshotTool, sendPdfTool } from '../chat-agent/tools/media';
import { commandToAgentPrompt } from '../chat-agent/commands';
import { enqueueAgentTurn, enqueueCallback } from '../chat-platforms/dispatch';
import { isSuperAdminEmail } from '../superadmin/auth';
import { getRecentWebhooks } from '../observability/store';
import { openTicket } from '../support/intake';
import { getPlatformHostname, getPlatformOrigin } from '../config/origins';

const ARTIFACT_CARD_LIMIT = 10;

const HELP_TEXT = [
  "I'm your ShareOut assistant in Telegram. I can find, read, summarize, and update the pages your ShareOut account can see.",
  '',
  'Useful commands:',
  '/artifacts - list pages in the current scope',
  '/search <text> - find a page',
  '/workspaces - show available workspaces',
  '/workspace <name> - switch workspace',
  '/personal - switch to personal pages',
  '/status - show connected account and scope',
  '/alerts - list metric alerts',
  '/schedules - list scheduled sends',
  '/snapshot <page> - send a page image',
  '/pdf <page> - send a PDF',
  '/refresh <page> - run live data if available',
  '/share <page> with <email> - share a page',
  '/edit <page>: <change> - propose a page edit',
  '/crew <page>: <task> - ask a page crew to work',
  '/support <what went wrong> - open a support ticket',
  '/settings - open Telegram settings',
  '/unlink - disconnect this chat',
  '',
  'You can also type normally, like "summarize the adoption report" or "what changed in the sales dashboard?"',
].join('\n');

const NOT_LINKED_TEXT =
  "Let’s connect your account first. Open ShareOut → Settings → Connect Telegram, then tap the link. Takes a few seconds.";

const START_NO_CODE_TEXT =
  'Welcome to ShareOut in Telegram. Connect your account first: open ShareOut -> Settings -> Connect Telegram, then tap the link there.';

const CODE_EXPIRED_TEXT =
  'That link expired. Grab a fresh one from Settings -> Connect Telegram.';

interface ParsedCommand {
  name: string;
  args: string;
}

interface ArtifactCardItem {
  id: string;
  name: string;
  slug: string;
  visibility?: string;
  artifact_type?: string;
  updated_at?: string | null;
  created_at?: string;
}

function parseCommand(text: string): ParsedCommand | null {
  const match = text.match(/^\/([A-Za-z0-9_]+)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  return { name: match[1].toLowerCase(), args: (match[2] || '').trim() };
}

function artifactUrl(env: Env, slug: string): string {
  const base = getPlatformOrigin(env);
  return `${base.replace(/\/$/, '')}/a/${slug}/`;
}

function artifactTitle(item: ArtifactCardItem): string {
  return item.name?.trim() || item.slug;
}

function artifactCardText(item: ArtifactCardItem): string {
  const updated = item.updated_at || item.created_at;
  const meta = [
    item.artifact_type || 'page',
    item.visibility,
    updated ? `updated ${updated.slice(0, 10)}` : '',
  ].filter(Boolean).join(' · ');
  return meta ? `${artifactTitle(item)}\n${meta}` : artifactTitle(item);
}

function artifactButtons(env: Env, item: ArtifactCardItem): InlineButton[][] {
  return [
    [{ text: 'Open Page', url: artifactUrl(env, item.slug) }],
    [
      { text: 'Snapshot', callback_data: `snap:${item.id}` },
      { text: 'PDF', callback_data: `pdf:${item.id}` },
    ],
    [
      { text: 'Ask AI', callback_data: `ask:${item.id}` },
      { text: 'Share', callback_data: `share:${item.id}` },
    ],
  ];
}

function workspaceButtons(workspaces: TelegramWorkspace[]): InlineButton[][] {
  const rows = workspaces.slice(0, 20).map((w) => ([
    { text: `${w.name} (${w.artifactCount})`, callback_data: `ws:${w.id}` },
  ]));
  rows.push([
    { text: 'All Pages', callback_data: 'ws:all' },
    { text: 'Personal', callback_data: `ws:${TELEGRAM_PERSONAL_WORKSPACE}` },
  ]);
  return rows;
}

// Telegram retries any non-2xx (and on timeout), so the webhook ALWAYS returns
// 200 — even on bad secret, malformed body, or internal error. Recoverable
// problems are surfaced to the user via sendMessage, not via the HTTP status.
function ok(): Response {
  return new Response(null, { status: 200 });
}

export async function routeTelegram(ctx: FetchContext): Promise<Response | null> {
  const { request, path } = ctx;

  if (path === '/telegram/webhook' && request.method === 'POST') {
    return handleWebhook(ctx);
  }

  return null;
}

async function handleWebhook(ctx: FetchContext): Promise<Response> {
  const { request, env } = ctx;

  // Authenticate: Telegram echoes the secret we registered via setWebhook.
  const secret = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
  if (!env.TELEGRAM_WEBHOOK_SECRET || secret !== env.TELEGRAM_WEBHOOK_SECRET) {
    return ok();
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return ok();
  }

  const work = dispatchUpdate(env, update);
  if (ctx.executionCtx) {
    ctx.executionCtx.waitUntil(work);
  } else {
    await work;
  }
  return ok();
}

async function dispatchUpdate(env: Env, update: TelegramUpdate): Promise<void> {
  if (update.callback_query) {
    await dispatchCallback(env, update);
    return;
  }

  const msg = update.message;
  if (!msg) return;
  const chatId = msg.chat.id;

  // Voice notes / audio files carry no .text — transcribe them with Whisper, then
  // route the transcript exactly like a typed message (commands included).
  const audio = msg.voice || msg.audio;
  let text: string;
  if (typeof msg.text === 'string') {
    text = msg.text.trim();
  } else if (audio) {
    const transcript = await handleVoiceMessage(env, chatId, audio);
    if (!transcript) return;
    text = transcript;
  } else {
    return;
  }

  const command = parseCommand(text);

  if (command?.name === 'start') {
    await handleStart(env, chatId, command.args);
    return;
  }
  if (command?.name === 'help') {
    await sendMessage(env, chatId, HELP_TEXT);
    return;
  }
  if (command?.name === 'unlink') {
    await unlinkChat(env, chatId);
    await sendMessage(env, chatId, 'Done — this chat is no longer linked to your ShareOut account.');
    return;
  }

  const userId = await getLinkedUserId(env, chatId);
  if (!userId) {
    await sendMessage(env, chatId, NOT_LINKED_TEXT);
    return;
  }

  if (command?.name === 'artifacts') {
    await handleListArtifacts(env, chatId, userId);
    return;
  }
  if (command?.name === 'search') {
    await handleSearchArtifacts(env, chatId, userId, command.args);
    return;
  }
  if (command?.name === 'workspaces' || command?.name === 'workspace') {
    await handleWorkspaceCommand(env, chatId, userId, command.args);
    return;
  }
  if (command?.name === 'personal') {
    await setSelectedTelegramWorkspace(env, chatId, TELEGRAM_PERSONAL_WORKSPACE);
    await sendMessage(env, chatId, 'Done — I’ll focus on your personal pages. Use /workspace all to see everything again.');
    return;
  }
  if (command?.name === 'status') {
    await handleStatus(env, chatId, userId);
    return;
  }
  if (command?.name === 'settings') {
    await sendMessage(env, chatId, `${getPlatformOrigin(env)}/settings/telegram`);
    return;
  }
  if (command?.name === 'logs') {
    await handleLogsCommand(env, chatId, userId, command.args);
    return;
  }
  if (command?.name === 'support' || command?.name === 'bug') {
    await handleSupportCommand(env, chatId, userId, command.args);
    return;
  }
  if (command) {
    const prompt = commandToAgentPrompt(command.name, command.args);
    if (prompt) {
      await dispatchAgentTurn(env, chatId, userId, prompt, update.update_id);
      return;
    }
    await sendMessage(env, chatId, `I don’t know /${command.name} yet. Try /help to see what I can do.`);
    return;
  }

  await dispatchAgentTurn(env, chatId, userId, text, update.update_id);
}

// Resolve a voice/audio message to its transcript, echoing what was heard so the
// user can confirm. Returns null (and replies to the user) on any failure.
async function handleVoiceMessage(
  env: Env,
  chatId: number,
  audio: NonNullable<import('../telegram/types').TelegramMessage['voice']>
): Promise<string | null> {
  const userId = await getLinkedUserId(env, chatId);
  if (!userId) {
    await sendMessage(env, chatId, NOT_LINKED_TEXT);
    return null;
  }
  await sendChatAction(env, chatId, 'typing');
  const selectedWorkspaceId = await getSelectedTelegramWorkspace(env, chatId);
  const result = await transcribeTelegramAudio(env, audio, { userId, selectedWorkspaceId });
  if (result.error || !result.text) {
    await sendMessage(env, chatId, result.error || 'I couldn’t make out that recording.');
    return null;
  }
  await sendMessage(env, chatId, `🎙️ “${result.text}”`);
  return result.text.trim();
}

async function handleSupportCommand(env: Env, chatId: number, userId: string, args: string): Promise<void> {
  const body = args.trim();
  if (!body) {
    await sendMessage(env, chatId, 'Tell me what went wrong — e.g. /support Publish button does nothing on my dashboard.');
    return;
  }
  const subject = body.length > 80 ? body.slice(0, 77) + '…' : body;
  await openTicket(env, {
    requesterUserId: userId,
    channel: 'telegram',
    channelRef: String(chatId),
    subject,
    body,
  });
  await sendMessage(env, chatId, 'Got it — your support ticket is open. Our team will reply here.');
}

async function dispatchAgentTurn(
  env: Env,
  chatId: number,
  userId: string,
  text: string,
  updateId: number
): Promise<void> {
  const selectedWorkspaceId = await getSelectedTelegramWorkspace(env, chatId);
  await enqueueAgentTurn(env, {
    platform: 'telegram',
    nativeChatId: chatId,
    userId,
    text,
    updateId,
    selectedWorkspaceId,
    onUnavailable: async (message) => sendMessage(env, chatId, message),
  });
}

// An inline-keyboard button tap (approve/cancel a proposed write). Routed to the
// per-chat coordinator, which holds the pending action and executes it.
async function dispatchCallback(env: Env, update: TelegramUpdate): Promise<void> {
  const cq = update.callback_query!;
  const chatId = cq.message?.chat.id;
  const messageId = cq.message?.message_id;
  if (chatId == null || messageId == null) return;

  const userId = await getLinkedUserId(env, chatId);
  if (!userId) {
    await answerCallbackQuery(env, cq.id, 'Connect your account first.');
    return;
  }

  if (await handleInlineActionCallback(env, {
    chatId,
    userId,
    data: cq.data || '',
    callbackId: cq.id,
    updateId: update.update_id,
    messageId,
  })) {
    return;
  }

  await enqueueCallback(env, {
    platform: 'telegram',
    nativeChatId: chatId,
    userId,
    data: cq.data || '',
    callbackId: cq.id,
    messageId,
    updateId: update.update_id,
    onUnavailable: async (message) => answerCallbackQuery(env, cq.id, message),
  });
}

async function handleInlineActionCallback(
  env: Env,
  b: { chatId: number; userId: string; data: string; callbackId: string; updateId: number; messageId: number }
): Promise<boolean> {
  const [kind, id] = b.data.split(':');
  if (!kind || !id) return false;

  if (kind === 'ar') {
    return handleAccessRequestTelegramCallback(
      env,
      b.userId,
      b.data,
      b.callbackId,
      b.chatId,
      b.messageId,
    );
  }

  if (kind === 'ws') {
    const selected = id === 'all' ? null : id;
    if (selected !== null && selected !== TELEGRAM_PERSONAL_WORKSPACE) {
      const allowed = (await listWorkspacesForUser(env, b.userId)).some((w) => w.id === selected);
      if (!allowed) {
        await answerCallbackQuery(env, b.callbackId, 'Workspace not found.');
        return true;
      }
    }
    await setSelectedTelegramWorkspace(env, b.chatId, selected);
    await answerCallbackQuery(env, b.callbackId, 'Workspace updated.');
    const label = selected === TELEGRAM_PERSONAL_WORKSPACE
      ? 'personal pages'
      : selected
        ? await describeWorkspaceSelection(env, b.userId, selected)
        : 'all accessible pages';
    await sendMessage(env, b.chatId, `Done — I’ll focus on ${label}. Try /artifacts or /search.`);
    return true;
  }

  if (kind !== 'snap' && kind !== 'pdf' && kind !== 'ask' && kind !== 'share') return false;

  const item = await getArtifactCardItem(env, b.userId, id);
  if (!item) {
    await answerCallbackQuery(env, b.callbackId, 'Page not found.');
    return true;
  }

  if (kind === 'snap' || kind === 'pdf') {
    await answerCallbackQuery(env, b.callbackId, kind === 'snap' ? 'Rendering snapshot…' : 'Rendering PDF…');
    const tool = kind === 'snap' ? sendSnapshotTool : sendPdfTool;
    const result = await tool.execute(
      { env, userId: b.userId, chatId: b.chatId },
      { artifact_id: id }
    ) as { error?: string };
    await sendMessage(env, b.chatId, result?.error || (kind === 'snap' ? 'Sent snapshot.' : 'Sent PDF.'));
    return true;
  }

  const title = artifactTitle(item);
  if (kind === 'ask') {
    await answerCallbackQuery(env, b.callbackId);
    await dispatchAgentTurn(
      env,
      b.chatId,
      b.userId,
      `The user tapped Ask AI for artifact_id ${id} (“${title}”). Ask what they want to know about this page. Do not answer the page yet.`,
      b.updateId
    );
    return true;
  }

  await answerCallbackQuery(env, b.callbackId);
  await dispatchAgentTurn(
    env,
    b.chatId,
    b.userId,
    `The user tapped Share for artifact_id ${id} (“${title}”). Ask who to share it with and whether they should be a viewer or editor.`,
    b.updateId
  );
  return true;
}

async function getArtifactCardItem(env: Env, userId: string, artifactId: string): Promise<ArtifactCardItem | null> {
  const access = await resolveArtifactAccessForUser(env, artifactId, userId);
  if (!access) return null;
  const row = await env.DB.prepare(`
    SELECT a.id, a.name, a.slug, a.visibility, a.artifact_type, d.updated_at, a.created_at
      FROM artifacts a
      LEFT JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
     WHERE a.id = ?
     LIMIT 1
  `).bind(artifactId).first<ArtifactCardItem>();
  return row ?? null;
}

async function handleListArtifacts(env: Env, chatId: number, userId: string): Promise<void> {
  const selectedWorkspaceId = await getSelectedTelegramWorkspace(env, chatId);
  const items = await listArtifactsForUser(env, userId, { limit: ARTIFACT_CARD_LIMIT, workspaceId: selectedWorkspaceId });
  const scope = await describeWorkspaceSelection(env, userId, selectedWorkspaceId);
  if (!items.length) {
    await sendMessage(env, chatId, `No pages found in ${scope}. Try /workspace all or create one at ${getPlatformHostname(env)}.`);
    return;
  }
  await sendArtifactCards(env, chatId, `Your pages in ${scope}:`, items);
}

async function handleSearchArtifacts(env: Env, chatId: number, userId: string, query: string): Promise<void> {
  if (!query) {
    await sendMessage(env, chatId, 'Try /search sales or /search adoption.');
    return;
  }
  const selectedWorkspaceId = await getSelectedTelegramWorkspace(env, chatId);
  const items = await listArtifactsForUser(env, userId, {
    search: query,
    limit: ARTIFACT_CARD_LIMIT,
    workspaceId: selectedWorkspaceId,
  });
  const scope = await describeWorkspaceSelection(env, userId, selectedWorkspaceId);
  if (!items.length) {
    await sendMessage(env, chatId, `No pages matched “${query}” in ${scope}. Try /workspace all to search everywhere.`);
    return;
  }
  await sendArtifactCards(env, chatId, `Matches for “${query}” in ${scope}:`, items);
}

async function sendArtifactCards(
  env: Env,
  chatId: number,
  heading: string,
  items: ArtifactCardItem[]
): Promise<void> {
  await sendMessage(env, chatId, `${heading}\nShowing ${items.length} page${items.length === 1 ? '' : 's'}.`);
  for (const item of items) {
    await sendMessageWithButtons(env, chatId, artifactCardText(item), artifactButtons(env, item));
  }
}

async function handleWorkspaceCommand(env: Env, chatId: number, userId: string, rawArg: string): Promise<void> {
  const arg = rawArg.trim().toLowerCase();
  const workspaces = await listWorkspacesForUser(env, userId);

  if (!arg) {
    const selected = await getSelectedTelegramWorkspace(env, chatId);
    const current = await describeWorkspaceSelection(env, userId, selected);
    const lines = workspaces.map((w) => `• ${w.name} (${w.slug}) - ${w.artifactCount} pages`);
    await sendMessageWithButtons(
      env,
      chatId,
      [
        `Current scope: ${current}.`,
        '',
        workspaces.length ? `Workspaces:\n${lines.join('\n')}` : 'No team workspaces yet.',
        '',
        'Pick a workspace below, or use /workspace all.',
      ].join('\n'),
      workspaceButtons(workspaces)
    );
    return;
  }

  if (arg === 'all' || arg === 'everything') {
    await setSelectedTelegramWorkspace(env, chatId, null);
    await sendMessage(env, chatId, 'Done — I’ll search across every page your linked accounts can access.');
    return;
  }
  if (arg === 'personal' || arg === 'private') {
    await setSelectedTelegramWorkspace(env, chatId, TELEGRAM_PERSONAL_WORKSPACE);
    await sendMessage(env, chatId, 'Done — I’ll focus on your personal pages.');
    return;
  }

  const match = findWorkspace(workspaces, rawArg);
  if (!match) {
    const names = workspaces.map((w) => w.slug).join(', ') || 'none';
    await sendMessage(env, chatId, `I couldn’t find that workspace. Available workspaces: ${names}.`);
    return;
  }

  await setSelectedTelegramWorkspace(env, chatId, match.id);
  await sendMessage(env, chatId, `Done — I’ll focus on ${match.name}. Try /artifacts or ask a question.`);
}

async function handleStatus(env: Env, chatId: number, userId: string): Promise<void> {
  const [user, workspaces, selected] = await Promise.all([
    env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(userId).first<{ email: string | null }>(),
    listWorkspacesForUser(env, userId),
    getSelectedTelegramWorkspace(env, chatId),
  ]);
  const scope = await describeWorkspaceSelection(env, userId, selected, workspaces);
  await sendMessage(
    env,
    chatId,
    [
      `Connected as: ${user?.email || 'your ShareOut account'}`,
      `Current scope: ${scope}`,
      `Workspaces: ${workspaces.length}`,
      '',
      'Use /workspace to switch, /artifacts to list pages, or /help for commands.',
    ].join('\n')
  );
}

function findWorkspace(workspaces: TelegramWorkspace[], raw: string): TelegramWorkspace | null {
  const arg = raw.trim().toLowerCase();
  return workspaces.find((w) =>
    w.id.toLowerCase() === arg ||
    w.slug.toLowerCase() === arg ||
    w.name.toLowerCase() === arg
  ) || workspaces.find((w) => w.name.toLowerCase().includes(arg)) || null;
}

async function describeWorkspaceSelection(
  env: Env,
  userId: string,
  selectedWorkspaceId: TelegramWorkspaceSelection,
  knownWorkspaces?: TelegramWorkspace[]
): Promise<string> {
  if (selectedWorkspaceId === TELEGRAM_PERSONAL_WORKSPACE) return 'personal pages';
  if (!selectedWorkspaceId) return 'all accessible pages';
  const workspaces = knownWorkspaces ?? await listWorkspacesForUser(env, userId);
  const workspace = workspaces.find((w) => w.id === selectedWorkspaceId);
  return workspace ? workspace.name : 'the selected workspace';
}

async function handleStart(env: Env, chatId: number, code: string): Promise<void> {
  if (!code) {
    const userId = await getLinkedUserId(env, chatId);
    await sendMessage(env, chatId, userId ? HELP_TEXT : START_NO_CODE_TEXT);
    return;
  }
  const userId = await consumeLinkCode(env, code);
  if (!userId) {
    await sendMessage(env, chatId, CODE_EXPIRED_TEXT);
    return;
  }
  await linkChat(env, chatId, userId);
  const row = await env.DB.prepare('SELECT email FROM users WHERE id = ?')
    .bind(userId)
    .first<{ email: string }>();
  const who = row?.email ? ` as ${row.email}` : '';
  await sendMessage(
    env,
    chatId,
    [
      `You’re connected${who}.`,
      '',
      'Welcome to ShareOut in Telegram. Ask me about your pages, or start with /workspaces and /artifacts.',
      '',
      'Try: "summarize my latest report", "/workspace marketing", or "/snapshot sales dashboard".',
    ].join('\n')
  );
}

async function handleLogsCommand(env: Env, chatId: number, userId: string, args: string): Promise<void> {
  const userRow = await env.DB.prepare('SELECT email FROM users WHERE id = ?')
    .bind(userId).first<{ email: string }>();
  if (!isSuperAdminEmail(userRow?.email)) {
    await sendMessage(env, chatId, 'This command is only available to platform admins.');
    return;
  }

  const source = args.trim() || undefined;
  const rows = await getRecentWebhooks(env, 15, source);

  if (!rows.length) {
    const msg = source ? ('No ' + source + ' webhook events logged yet.') : 'No webhook events logged yet.';
    await sendMessage(env, chatId, msg);
    return;
  }

  const icon = (o: string) => o === 'ok' ? 'OK' : o === 'ignored' ? '--' : o === 'invalid_signature' ? 'SIG' : 'ERR';
  const lines = rows.map(r => {
    const ts = r.created_at.slice(5, 16).replace('T', ' ');
    const detail = r.detail ? ('\n  ' + r.detail.slice(0, 80)) : '';
    return '[' + icon(r.outcome) + '] ' + ts + ' ' + r.source + ' ' + r.type + detail;
  });

  const header = source
    ? ('Webhook log - ' + source + ' (last ' + rows.length + ')')
    : ('Webhook log (last ' + rows.length + ')');
  await sendMessage(env, chatId, header + '\n\n' + lines.join('\n\n'));
}
