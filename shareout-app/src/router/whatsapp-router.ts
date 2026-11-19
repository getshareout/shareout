import type { Env } from '../types';
import type { FetchContext } from './context';
import type { BotChannel } from '../chat-platforms/bot/router';
import { handleBotButton, handleBotText } from '../chat-platforms/bot/router';
import { BOT_COPY } from '../chat-platforms/bot/copy';
import {
  consumeBotLinkCode,
  getBotLinkedUserId,
  getBotSelectedWorkspace,
  linkBotSession,
  setBotSelectedWorkspace,
  unlinkBotSession,
} from '../chat-platforms/bot/links';
import { createWhatsAppReplyPort } from '../chat-platforms/whatsapp/reply-port';
import { artifactListText } from '../chat-platforms/whatsapp/format';
import { verifyWhatsAppSignature, whatsAppSubscribeChallenge } from '../chat-platforms/whatsapp/verify';
import {
  MAX_BUTTONS,
  MAX_LIST_ROWS,
  downloadWhatsAppMedia,
  markWhatsAppReadTyping,
  sendWhatsAppButtons,
  sendWhatsAppList,
  sendWhatsAppText,
  whatsAppConfigured,
  type WhatsAppTarget,
} from '../whatsapp/client';
import { artifactLink } from '../artifacts/page-links';
import { transcribeAudioBytes, MAX_AUDIO_BYTES } from '../data/transcribe';
import { PERSONAL_SCOPE, type WorkspaceSelection } from '../chat-platforms/types';
import { localeForRecipient, type Locale } from '../i18n/locale';
import { t } from '../i18n';
import { createLogger } from '../logging';
import { checkSlidingWindowRateLimit } from '../rate-limit';
import { getPlatformOrigin } from '../config/origins';

// WhatsApp's side of the shared bot (chat-platforms/bot/router.ts): verify Meta's webhook,
// turn each inbound message into text or a button tap, and answer through the Cloud API.
// Only people who write first are answered (Meta's 24-hour service window) — nothing here
// starts a conversation.

/** The parts of Meta's `messages` webhook this bot reads. */
interface WhatsAppInbound {
  id: string;
  from?: string;
  from_user_id?: string;
  type: string;
  text?: { body?: string };
  audio?: { id?: string; mime_type?: string };
  interactive?: { type?: string; button_reply?: { id?: string }; list_reply?: { id?: string } };
}

interface WhatsAppWebhook {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: { metadata?: { phone_number_id?: string }; messages?: WhatsAppInbound[] };
    }>;
  }>;
}

const SPANISH_COUNTRIES = new Set(['AR', 'BO', 'CL', 'CO', 'CR', 'CU', 'DO', 'EC', 'ES', 'GT', 'HN', 'MX', 'NI', 'PA', 'PE', 'PR', 'PY', 'SV', 'UY', 'VE']);
const SPANISH_PREFIXES = ['54', '591', '56', '57', '506', '53', '1809', '1829', '1849', '593', '34', '502', '504', '52', '505', '507', '51', '1787', '1939', '595', '503', '598', '58'];

/** The language to greet someone in before their account is known: Spanish for Spanish-speaking countries. */
export function whatsappLocaleHint(id: string): Locale {
  const country = /^([A-Z]{2})\./.exec(id)?.[1];
  if (country) return SPANISH_COUNTRIES.has(country) ? 'es' : 'en';
  const digits = id.replace(/\D/g, '');
  return SPANISH_PREFIXES.some((p) => digits.startsWith(p)) ? 'es' : 'en';
}

/** A stable numeric dedup id for a WhatsApp message id (the session dedups turns by number). */
export async function whatsappEventId(messageId: string): Promise<number> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(messageId)));
  let n = 0;
  for (let i = 0; i < 6; i++) n = n * 256 + digest[i];
  return n;
}

export async function routeWhatsApp(ctx: FetchContext): Promise<Response | null> {
  const { path } = ctx;
  if (path === '/whatsapp/webhook') return handleWebhook(ctx);
  return null;
}

async function handleWebhook(ctx: FetchContext): Promise<Response> {
  const { request, env } = ctx;
  if (request.method === 'GET') {
    const challenge = whatsAppSubscribeChallenge(env, new URL(request.url));
    return challenge != null
      ? new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
      : new Response('Forbidden', { status: 403 });
  }
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const raw = await request.text();
  if (!(await verifyWhatsAppSignature(env, raw, request.headers.get('X-Hub-Signature-256')))) {
    return new Response('Unauthorized', { status: 401 });
  }
  let body: WhatsAppWebhook;
  try {
    body = JSON.parse(raw) as WhatsAppWebhook;
  } catch {
    return new Response(null, { status: 200 });
  }

  // Meta retries anything but a quick 200, so the work runs after the response.
  const work = dispatchWebhook(env, body).catch((err) => {
    createLogger(env, { scope: 'whatsapp' }).warn('webhook dispatch failed', { error: err instanceof Error ? err.message : String(err) });
  });
  if (ctx.executionCtx) ctx.executionCtx.waitUntil(work);
  else await work;
  return new Response(null, { status: 200 });
}

async function dispatchWebhook(env: Env, body: WhatsAppWebhook): Promise<void> {
  if (body.object !== 'whatsapp_business_account' || !whatsAppConfigured(env)) return;
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      // Delivery/read statuses carry no messages; another number's traffic is not ours.
      if (change.field !== 'messages' || !value?.messages?.length) continue;
      if (value.metadata?.phone_number_id !== env.WHATSAPP_PHONE_NUMBER_ID) continue;
      for (const message of value.messages) await handleInbound(env, message);
    }
  }
}

const workspaceOf = (ws: WorkspaceSelection): string | null => (typeof ws === 'string' && ws !== PERSONAL_SCOPE ? ws : null);

/** The shared bot's view of one WhatsApp chat. Each message it sends is billed to the chat's workspace. */
export function whatsappChannel(env: Env, opts: { sessionKey: string; phone: string | null; eventId: number; messageId: string }): BotChannel {
  const { sessionKey, phone } = opts;
  let selected: WorkspaceSelection | undefined;
  let userId: string | null | undefined;
  const linkedUser = async () => (userId !== undefined ? userId : (userId = await getBotLinkedUserId(env, 'whatsapp', sessionKey)));
  const selection = async () => (selected !== undefined ? selected : (selected = await getBotSelectedWorkspace(env, 'whatsapp', sessionKey)));
  const target = async (): Promise<WhatsAppTarget> => ({
    to: sessionKey,
    meter: { workspaceId: workspaceOf(await selection()), userId: await linkedUser() },
  });

  return {
    platform: 'whatsapp',
    nativeChatId: sessionKey,
    eventId: opts.eventId,
    inboundMessageId: opts.messageId,
    localeHint: whatsappLocaleHint(sessionKey),
    getLinkedUserId: linkedUser,
    consumeLinkCode: (code) => consumeBotLinkCode(env, 'whatsapp', code),
    async link(id) {
      await linkBotSession(env, 'whatsapp', sessionKey, id, phone);
      userId = id;
      selected = null;
    },
    async unlink() {
      await unlinkBotSession(env, 'whatsapp', sessionKey);
      userId = null;
    },
    getSelectedWorkspace: selection,
    async setSelectedWorkspace(ws) {
      await setBotSelectedWorkspace(env, 'whatsapp', sessionKey, ws);
      selected = ws;
    },
    async sendText(text) {
      await sendWhatsAppText(env, await target(), text);
    },
    async sendChoices(text, choices, buttonLabel) {
      const to = await target();
      if (choices.length <= MAX_BUTTONS) await sendWhatsAppButtons(env, to, text, choices.map((c) => ({ id: c.id, title: c.label })));
      else if (choices.length <= MAX_LIST_ROWS) await sendWhatsAppList(env, to, text, buttonLabel, choices.map((c) => ({ id: c.id, title: c.label })));
      else await sendWhatsAppText(env, to, `${text}\n\n${choices.map((c) => `• /workspace ${c.label}`).join('\n')}`);
    },
    async sendArtifactCards(heading, items) {
      await sendWhatsAppText(env, await target(), artifactListText(heading, items, (slug) => artifactLink(env, slug)));
    },
    // No tap acknowledgement on WhatsApp; a note for the person goes out as a message.
    async answerButton(text, o) {
      if (text && !o?.transient) await sendWhatsAppText(env, await target(), text);
    },
    replyPort() {
      const ws = selected;
      return createWhatsAppReplyPort(env, {
        to: sessionKey,
        meter: { workspaceId: ws === undefined ? null : workspaceOf(ws), userId: userId ?? null },
        inboundMessageId: opts.messageId,
      });
    },
  };
}

const SEEN_TTL_SECONDS = 2 * 86400;

/**
 * Meta can deliver one message twice (a retry, a double delivery). Every reply is billed, so
 * a message id is handled once: the first delivery claims it for two days. KV has no
 * set-if-absent, so two deliveries landing in the same instant can still both pass — rare,
 * and agent turns are deduplicated again in the session Durable Object.
 */
async function firstDelivery(env: Env, messageId: string): Promise<boolean> {
  const kv = env.RATE_LIMIT_KV;
  if (!kv) return true;
  const key = `wa:seen:${messageId}`;
  if (await kv.get(key).catch(() => null)) return false;
  await kv.put(key, '1', { expirationTtl: SEEN_TTL_SECONDS }).catch(() => {});
  return true;
}

/**
 * Someone without a linked account is answered (how to connect, an expired code…) at no
 * workspace's expense, so a stranger who finds the number gets a few replies an hour, then
 * silence. No KV means no limit to enforce — and no linking either — so they get none.
 */
async function mayAnswerStranger(env: Env, sessionKey: string): Promise<boolean> {
  if (!env.RATE_LIMIT_KV) return false;
  return (await checkSlidingWindowRateLimit(env.RATE_LIMIT_KV, `wa:${sessionKey}`, 'whatsappUnlinked')).allowed;
}

async function handleInbound(env: Env, message: WhatsAppInbound): Promise<void> {
  const sessionKey = message.from_user_id || message.from;
  if (!sessionKey || !message.id) return;
  if (!(await firstDelivery(env, message.id))) return;
  const channel = whatsappChannel(env, {
    sessionKey,
    phone: message.from ?? null,
    eventId: await whatsappEventId(message.id),
    messageId: message.id,
  });
  if (!(await channel.getLinkedUserId()) && !(await mayAnswerStranger(env, sessionKey))) return;

  if (message.type === 'text' && message.text?.body) {
    await handleBotText(env, channel, message.text.body);
    return;
  }
  if (message.type === 'interactive') {
    const data = message.interactive?.button_reply?.id || message.interactive?.list_reply?.id;
    if (data) await handleBotButton(env, channel, data, { callbackId: message.id, messageId: message.id });
    return;
  }
  if (message.type === 'audio' && message.audio?.id) {
    const transcript = await transcribeVoiceNote(env, channel, message.audio.id);
    if (transcript) await handleBotText(env, channel, transcript);
    return;
  }
  // Photos, files, stickers… say once what the bot can read.
  const userId = await channel.getLinkedUserId();
  const locale = userId ? await localeForRecipient(env, { userId }).catch((): Locale => channel.localeHint ?? 'en') : channel.localeHint ?? 'en';
  await channel.sendText(t(locale, UNSUPPORTED_COPY));
}

const UNSUPPORTED_COPY = {
  en: 'I can read text messages and voice notes. Write me what you need.',
  es: 'Puedo leer mensajes de texto y notas de voz. Escribime qué necesitás.',
};

/** Transcribe a voice note with the shared Whisper core and echo what was heard. */
async function transcribeVoiceNote(env: Env, channel: BotChannel, mediaId: string): Promise<string | null> {
  const userId = await channel.getLinkedUserId();
  const locale = userId ? await localeForRecipient(env, { userId }).catch((): Locale => channel.localeHint ?? 'en') : channel.localeHint ?? 'en';
  if (!userId) {
    await channel.sendText(t(locale, BOT_COPY).notLinked(`${getPlatformOrigin(env)}/settings/whatsapp`));
    return null;
  }
  if (!env.AI) {
    await channel.sendText(locale === 'es' ? 'No puedo escuchar audios ahora. Escribime, por favor.' : 'Voice notes are unavailable right now. Please type your message.');
    return null;
  }
  if (channel.inboundMessageId) await markWhatsAppReadTyping(env, channel.inboundMessageId);
  const bytes = await downloadWhatsAppMedia(env, mediaId);
  if (!bytes || bytes.byteLength > MAX_AUDIO_BYTES) {
    await channel.sendText(locale === 'es' ? 'No pude bajar ese audio. ¿Lo mandás de nuevo?' : 'I couldn’t download that audio. Mind resending it?');
    return null;
  }
  const result = await transcribeAudioBytes(env, bytes, {
    // WhatsApp sends no duration: a voice note is Opus at about 16 kbit/s, ~2 KB a second.
    durationSec: Math.round(bytes.byteLength / 2000),
    userId,
    workspaceId: workspaceOf(await channel.getSelectedWorkspace()),
    source: 'whatsapp',
  });
  if (result.error || !result.text) {
    await channel.sendText(result.error || (locale === 'es' ? 'No entendí ese audio.' : 'I couldn’t make out that recording.'));
    return null;
  }
  // Unlike Telegram, the transcript is not echoed back: that would be one more billed message.
  return result.text.trim();
}
