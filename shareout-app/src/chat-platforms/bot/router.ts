import type { Env } from '../../types';
import type { ArtifactCardItem, ChatReplyPort, WorkspaceSelection } from '../types';
import type { BotPlatformId } from './links';
import { BOT_COPY, type BotCopy } from './copy';
import { findBotWorkspace, resolveBotWorkspace, eligibleBotWorkspaces } from './workspace';
import { listArtifactsForUser } from '../../chat-agent/tools/artifacts';
import { resolveArtifactAccessForUser } from '../../chat-agent/access';
import { sendSnapshotTool, sendPdfTool } from '../../chat-agent/tools/media';
import { commandToAgentPrompt } from '../../chat-agent/commands';
import { enqueueAgentTurn, enqueueCallback } from '../dispatch';
import { localeForRecipient, type Locale } from '../../i18n/locale';
import { t } from '../../i18n';
import { isSuperAdminEmail } from '../../superadmin/recipients';
import { getRecentWebhooks } from '../../observability/store';
import { openTicket } from '../../support/intake';
import { getPlatformHostname, getPlatformOrigin } from '../../config/origins';

// The shared bot for Telegram and WhatsApp: linking, commands, the workspace a chat works in
// and handing turns to the agent. Each app's router only translates its webhook into
// handleBotText / handleBotButton calls and implements a BotChannel; everything a person
// sees outside the agent's answers is decided here, so both apps behave the same.

const ARTIFACT_CARD_LIMIT = 10;
const PENDING_TTL_SECONDS = 600;
const APP_NAME: Record<BotPlatformId, string> = { telegram: 'Telegram', whatsapp: 'WhatsApp' };

export interface BotChoice {
  /** Echoed back as the button's data: `ws:<id>` for a workspace. */
  id: string;
  label: string;
}

/** One inbound event on one chat, with the app-specific ways to answer it. */
export interface BotChannel {
  readonly platform: BotPlatformId;
  /** What the session Durable Object is keyed by (Telegram chat id, WhatsApp user id). */
  readonly nativeChatId: number | string;
  /** Dedup id for agent turns (Telegram update_id, a hash of the WhatsApp message id). */
  readonly eventId: number;
  /** WhatsApp: the inbound message id, so the agent can show "typing…" against it. */
  readonly inboundMessageId?: string;
  /** Language to greet someone in before their account is known. */
  readonly localeHint?: Locale;
  getLinkedUserId(): Promise<string | null>;
  consumeLinkCode(code: string): Promise<string | null>;
  link(userId: string): Promise<void>;
  unlink(): Promise<void>;
  getSelectedWorkspace(): Promise<WorkspaceSelection>;
  setSelectedWorkspace(workspaceId: WorkspaceSelection): Promise<void>;
  sendText(text: string): Promise<void>;
  sendChoices(text: string, choices: BotChoice[], buttonLabel: string): Promise<void>;
  sendArtifactCards(heading: string, items: ArtifactCardItem[], userId: string): Promise<void>;
  /**
   * Acknowledge a button tap. Telegram shows the text as a toast; WhatsApp has none, so it sends
   * the text as a message unless it is `transient` (a progress note not worth a billed message).
   */
  answerButton(text?: string, opts?: { transient?: boolean }): Promise<void>;
  /** The reply port the agent uses on this chat, for snapshots and PDFs sent from a button. */
  replyPort(): ChatReplyPort;
}

interface ParsedCommand {
  name: string;
  args: string;
}

export function parseBotCommand(text: string): ParsedCommand | null {
  const match = text.match(/^\/([A-Za-z0-9_]+)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  return { name: match[1].toLowerCase(), args: (match[2] || '').trim() };
}

const CODE_RE = /\b([0-9a-f]{32})\b/;

/** A link code in `/start <code>` (Telegram deep link) or in the short message WhatsApp pre-fills. */
export function linkCodeIn(text: string, command: ParsedCommand | null): string | null {
  if (command && (command.name === 'start' || command.name === 'link')) return CODE_RE.exec(command.args)?.[1] ?? (command.args || null);
  if (!command && text.length <= 200) return CODE_RE.exec(text)?.[1] ?? null;
  return null;
}

const settingsUrl = (env: Env, platform: BotPlatformId) => `${getPlatformOrigin(env)}/settings/${platform}`;

async function copyFor(env: Env, ch: BotChannel, userId: string | null): Promise<{ copy: BotCopy; locale: Locale }> {
  const locale = userId
    ? await localeForRecipient(env, { userId }).catch((): Locale => ch.localeHint ?? 'en')
    : ch.localeHint ?? 'en';
  return { copy: t(locale, BOT_COPY), locale };
}

const pendingKey = (ch: BotChannel) => `bot:pending:${ch.platform}:${ch.nativeChatId}`;

/** A typed message (or a voice note's transcript). */
export async function handleBotText(env: Env, ch: BotChannel, rawText: string): Promise<void> {
  const text = rawText.trim();
  if (!text) return;
  const command = parseBotCommand(text);
  const app = APP_NAME[ch.platform];

  const code = linkCodeIn(text, command);
  if (code || command?.name === 'start') {
    await handleStart(env, ch, code);
    return;
  }

  const userId = await ch.getLinkedUserId();
  const { copy, locale } = await copyFor(env, ch, userId);

  if (command?.name === 'help') {
    await ch.sendText(copy.help(app));
    return;
  }
  if (command?.name === 'unlink') {
    await ch.unlink();
    await ch.sendText(copy.unlinked);
    return;
  }
  if (!userId) {
    await ch.sendText(copy.notLinked(settingsUrl(env, ch.platform)));
    return;
  }

  switch (command?.name) {
    case 'workspaces':
    case 'workspace':
      await handleWorkspaceCommand(env, ch, userId, command.args, copy);
      return;
    case 'personal':
      await ch.sendText(copy.oneWorkspaceOnly);
      return;
    case 'status':
      await handleStatus(env, ch, userId, copy);
      return;
    case 'artifacts':
      await handleListArtifacts(env, ch, userId, '', copy);
      return;
    case 'search':
      if (!command.args) await ch.sendText(copy.searchHint);
      else await handleListArtifacts(env, ch, userId, command.args, copy);
      return;
    case 'settings':
      await ch.sendText(settingsUrl(env, ch.platform));
      return;
    case 'logs':
      await handleLogsCommand(env, ch, userId, command.args, copy);
      return;
    case 'support':
    case 'bug':
      await handleSupportCommand(env, ch, userId, command.args, copy);
      return;
  }
  if (command) {
    const prompt = commandToAgentPrompt(command.name, command.args, locale);
    if (prompt) await dispatchAgentTurn(env, ch, userId, prompt, copy);
    else await ch.sendText(copy.unknownCommand(command.name));
    return;
  }
  await dispatchAgentTurn(env, ch, userId, text, copy);
}

/**
 * A button tap. Handles the workspace picker and page-card buttons; a confirmation
 * (`ok:` / `no:`) goes to the agent's session. Returns false for data it does not know.
 */
export async function handleBotButton(
  env: Env,
  ch: BotChannel,
  data: string,
  tap: { callbackId: string; messageId: number | string },
): Promise<boolean> {
  const userId = await ch.getLinkedUserId();
  const { copy } = await copyFor(env, ch, userId);
  if (!userId) {
    await ch.answerButton(copy.notLinked(settingsUrl(env, ch.platform)));
    return true;
  }
  const [kind, id] = data.split(':');
  if (!kind || !id) return false;

  if (kind === 'ws') {
    const { eligible } = await eligibleBotWorkspaces(env, ch.platform, userId);
    const match = eligible.find((w) => w.id === id);
    if (!match) {
      await ch.answerButton(copy.workspaceGone);
      return true;
    }
    await ch.setSelectedWorkspace(match.id);
    await ch.answerButton();
    await ch.sendText(copy.workspaceSet(match.name));
    await runPendingQuestion(env, ch, userId, copy);
    return true;
  }

  if (kind === 'snap' || kind === 'pdf' || kind === 'ask' || kind === 'share') {
    const item = await getArtifactCardItem(env, userId, id);
    if (!item) {
      await ch.answerButton(copy.pageNotFound);
      return true;
    }
    if (kind === 'snap' || kind === 'pdf') {
      const pdf = kind === 'pdf';
      await ch.answerButton(copy.rendering(pdf), { transient: true });
      await ch.getSelectedWorkspace(); // loads the workspace the reply port bills to
      const tool = pdf ? sendPdfTool : sendSnapshotTool;
      const result = await tool.execute(
        { env, userId, platform: ch.platform, reply: ch.replyPort(), ...(typeof ch.nativeChatId === 'number' ? { chatId: ch.nativeChatId } : {}) },
        { artifact_id: id },
      ) as { error?: string };
      await ch.sendText(result?.error || copy.sent(pdf));
      return true;
    }
    const title = item.name?.trim() || item.slug;
    await ch.answerButton();
    await dispatchAgentTurn(env, ch, userId, kind === 'ask'
      ? `The user tapped Ask AI for artifact_id ${id} (“${title}”). Ask what they want to know about this page. Do not answer the page yet.`
      : `The user tapped Share for artifact_id ${id} (“${title}”). Ask who to share it with and whether they should be a viewer or editor.`, copy);
    return true;
  }

  if (kind === 'ok' || kind === 'no') {
    await enqueueCallback(env, {
      platform: ch.platform,
      nativeChatId: ch.nativeChatId,
      userId,
      data,
      callbackId: tap.callbackId,
      messageId: tap.messageId,
      updateId: ch.eventId,
      selectedWorkspaceId: await ch.getSelectedWorkspace(),
      onUnavailable: async (message) => ch.answerButton(message),
    });
    return true;
  }
  return false;
}

async function handleStart(env: Env, ch: BotChannel, code: string | null): Promise<void> {
  const app = APP_NAME[ch.platform];
  if (!code) {
    const userId = await ch.getLinkedUserId();
    const { copy } = await copyFor(env, ch, userId);
    await ch.sendText(userId ? copy.help(app) : copy.welcomeNoCode(settingsUrl(env, ch.platform)));
    return;
  }
  const userId = await ch.consumeLinkCode(code);
  if (!userId) {
    const { copy } = await copyFor(env, ch, null);
    await ch.sendText(copy.codeExpired(settingsUrl(env, ch.platform)));
    return;
  }
  await ch.link(userId);
  const { copy } = await copyFor(env, ch, userId);
  const row = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(userId).first<{ email: string | null }>();
  await ch.sendText(copy.linked(row?.email ?? '', app));
  // Settle the workspace right away: picked for them when there is one, asked when several.
  const state = await resolveBotWorkspace(env, ch.platform, userId, await ch.getSelectedWorkspace(), (ws) => ch.setSelectedWorkspace(ws));
  if (state.kind === 'ready') await ch.sendText(copy.currentWorkspace(state.workspace.name));
  else await explainNoWorkspace(ch, state, copy);
}

async function explainNoWorkspace(
  ch: BotChannel,
  state: Exclude<Awaited<ReturnType<typeof resolveBotWorkspace>>, { kind: 'ready' }>,
  copy: BotCopy,
): Promise<void> {
  if (state.kind === 'choose') {
    await sendWorkspacePicker(ch, state.workspaces, copy);
    return;
  }
  await ch.sendText(state.member ? copy.notEnabled(APP_NAME[ch.platform]) : copy.noWorkspace);
}

async function sendWorkspacePicker(ch: BotChannel, workspaces: Array<{ id: string; name: string; slug: string }>, copy: BotCopy): Promise<void> {
  const choices = workspaces.slice(0, 20).map((w) => ({ id: `ws:${w.id}`, label: w.name }));
  await ch.sendChoices(copy.pickWorkspace, choices, copy.workspaceButton);
}

/** Hand a question to the agent inside the chat's workspace; ask for one first when it is not settled. */
async function dispatchAgentTurn(env: Env, ch: BotChannel, userId: string, text: string, copy: BotCopy): Promise<void> {
  const state = await resolveBotWorkspace(env, ch.platform, userId, await ch.getSelectedWorkspace(), (ws) => ch.setSelectedWorkspace(ws));
  if (state.kind !== 'ready') {
    // Keep the question so it runs once they pick a workspace.
    if (state.kind === 'choose' && env.RATE_LIMIT_KV) {
      await env.RATE_LIMIT_KV.put(pendingKey(ch), JSON.stringify({ userId, text }), { expirationTtl: PENDING_TTL_SECONDS }).catch(() => {});
    }
    await explainNoWorkspace(ch, state, copy);
    return;
  }
  await enqueueAgentTurn(env, {
    platform: ch.platform,
    nativeChatId: ch.nativeChatId,
    userId,
    text,
    updateId: ch.eventId,
    selectedWorkspaceId: state.workspace.id,
    ...(ch.inboundMessageId ? { inboundMessageId: ch.inboundMessageId } : {}),
    onUnavailable: async (message) => ch.sendText(message),
  });
}

async function runPendingQuestion(env: Env, ch: BotChannel, userId: string, copy: BotCopy): Promise<void> {
  if (!env.RATE_LIMIT_KV) return;
  const raw = await env.RATE_LIMIT_KV.get(pendingKey(ch)).catch(() => null);
  if (!raw) return;
  await env.RATE_LIMIT_KV.delete(pendingKey(ch)).catch(() => {});
  try {
    const pending = JSON.parse(raw) as { userId?: string; text?: string };
    if (pending.userId === userId && pending.text) await dispatchAgentTurn(env, ch, userId, pending.text, copy);
  } catch {
    // A malformed entry is dropped; they can ask again.
  }
}

async function handleWorkspaceCommand(env: Env, ch: BotChannel, userId: string, rawArg: string, copy: BotCopy): Promise<void> {
  const { eligible, all } = await eligibleBotWorkspaces(env, ch.platform, userId);
  if (!eligible.length) {
    await ch.sendText(all.length ? copy.notEnabled(APP_NAME[ch.platform]) : copy.noWorkspace);
    return;
  }
  if (!rawArg.trim()) {
    const selected = await ch.getSelectedWorkspace();
    const current = eligible.find((w) => w.id === selected);
    const lead = current ? `${copy.currentWorkspace(current.name)}\n\n` : '';
    await ch.sendChoices(`${lead}${copy.pickWorkspace}`, eligible.slice(0, 20).map((w) => ({ id: `ws:${w.id}`, label: w.name })), copy.workspaceButton);
    return;
  }
  const match = findBotWorkspace(eligible, rawArg);
  if (!match) {
    await ch.sendText(copy.workspaceNotFound(eligible.map((w) => w.slug).join(', ')));
    return;
  }
  await ch.setSelectedWorkspace(match.id);
  await ch.sendText(copy.workspaceSet(match.name));
  await runPendingQuestion(env, ch, userId, copy);
}

async function handleStatus(env: Env, ch: BotChannel, userId: string, copy: BotCopy): Promise<void> {
  const [user, { eligible }, selected] = await Promise.all([
    env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(userId).first<{ email: string | null }>(),
    eligibleBotWorkspaces(env, ch.platform, userId),
    ch.getSelectedWorkspace(),
  ]);
  const current = eligible.find((w) => w.id === selected);
  await ch.sendText(copy.status(user?.email || 'ShareOut', current?.name ?? copy.noneSelected, eligible.length));
}

async function handleListArtifacts(env: Env, ch: BotChannel, userId: string, query: string, copy: BotCopy): Promise<void> {
  const state = await resolveBotWorkspace(env, ch.platform, userId, await ch.getSelectedWorkspace(), (ws) => ch.setSelectedWorkspace(ws));
  if (state.kind !== 'ready') {
    await explainNoWorkspace(ch, state, copy);
    return;
  }
  const scope = state.workspace.name;
  const items = await listArtifactsForUser(env, userId, {
    ...(query ? { search: query } : {}),
    limit: ARTIFACT_CARD_LIMIT,
    workspaceId: state.workspace.id,
  });
  if (!items.length) {
    await ch.sendText(query ? copy.noMatches(query, scope) : copy.noPages(scope, getPlatformHostname(env)));
    return;
  }
  const heading = query ? copy.matchesIn(query, scope) : copy.pagesIn(scope);
  await ch.sendArtifactCards(`${heading}\n${copy.showing(items.length)}`, items, userId);
}

async function handleSupportCommand(env: Env, ch: BotChannel, userId: string, args: string, copy: BotCopy): Promise<void> {
  const body = args.trim();
  if (!body) {
    await ch.sendText(copy.supportHint);
    return;
  }
  const subject = body.length > 80 ? body.slice(0, 77) + '…' : body;
  await openTicket(env, {
    requesterUserId: userId,
    channel: ch.platform,
    channelRef: String(ch.nativeChatId),
    subject,
    body,
  });
  await ch.sendText(ch.platform === 'whatsapp' ? copy.supportOpenedByEmail : copy.supportOpened);
}

async function handleLogsCommand(env: Env, ch: BotChannel, userId: string, args: string, copy: BotCopy): Promise<void> {
  const userRow = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(userId).first<{ email: string }>();
  if (!isSuperAdminEmail(userRow?.email)) {
    await ch.sendText(copy.adminOnly);
    return;
  }
  const source = args.trim() || undefined;
  const rows = await getRecentWebhooks(env, 15, source);
  if (!rows.length) {
    await ch.sendText(source ? ('No ' + source + ' webhook events logged yet.') : 'No webhook events logged yet.');
    return;
  }
  const icon = (o: string) => o === 'ok' ? 'OK' : o === 'ignored' ? '--' : o === 'invalid_signature' ? 'SIG' : 'ERR';
  const lines = rows.map((r) => {
    const ts = r.created_at.slice(5, 16).replace('T', ' ');
    const detail = r.detail ? ('\n  ' + r.detail.slice(0, 80)) : '';
    return '[' + icon(r.outcome) + '] ' + ts + ' ' + r.source + ' ' + r.type + detail;
  });
  const header = source ? ('Webhook log - ' + source + ' (last ' + rows.length + ')') : ('Webhook log (last ' + rows.length + ')');
  await ch.sendText(header + '\n\n' + lines.join('\n\n'));
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
