import type { Env } from '../types';
import { createLogger } from '../logging';
import { meterWhatsAppMessage, type WhatsAppMeter } from '../chat-platforms/whatsapp/metering';

// Meta's WhatsApp Cloud API, called directly (no reseller in between).
// https://developers.facebook.com/documentation/business-messaging/whatsapp
const GRAPH = 'https://graph.facebook.com';
export const WHATSAPP_API_VERSION = 'v27.0';
/** Meta rejects text bodies over 4096 characters; chunk below that. */
export const MAX_TEXT_LEN = 4000;
export const MAX_BUTTONS = 3;
export const MAX_BUTTON_TITLE = 20;
export const MAX_LIST_ROWS = 10;
export const MAX_ROW_TITLE = 24;
export const MAX_ROW_DESCRIPTION = 72;
const MAX_INTERACTIVE_BODY = 1024;

/** Configured when the phone number id and its access token are set. */
export function whatsAppConfigured(env: Env): boolean {
  return !!(env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID);
}

/**
 * Who a message goes to and which workspace pays for it. `to` is the phone number (digits)
 * or, for someone who hides it behind a username, their business-scoped user id (`AR.1349…`).
 * Every message Meta accepts is metered against `meter.workspaceId` — one choke point, so no
 * reply goes out unbilled.
 */
export interface WhatsAppTarget {
  to: string;
  meter: WhatsAppMeter;
}

const isUserId = (to: string) => /^[A-Z]{2}\./.test(to);

function clip(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + '…';
}

/** Split on paragraph/line boundaries where possible so chunks read naturally. */
export function chunkWhatsAppText(text: string): string[] {
  if (text.length <= MAX_TEXT_LEN) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > MAX_TEXT_LEN) {
    let cut = rest.lastIndexOf('\n', MAX_TEXT_LEN);
    if (cut < MAX_TEXT_LEN * 0.5) cut = MAX_TEXT_LEN;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, '');
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function graphUrl(env: Env, path: string): string {
  return `${GRAPH}/${WHATSAPP_API_VERSION}/${path}`;
}

/** An edge of the bot's phone number: `messages` (send, read marks) or `media` (uploads). */
function phoneEdge(env: Env, edge: 'messages' | 'media'): string {
  return graphUrl(env, `${env.WHATSAPP_PHONE_NUMBER_ID}/${edge}`);
}

function authHeaders(env: Env): Record<string, string> {
  return { Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}` };
}

/** Send one message; returns Meta's message id, or null when it was refused (logged, never thrown). */
async function sendMessage(env: Env, target: WhatsAppTarget, payload: Record<string, unknown>): Promise<string | null> {
  if (!whatsAppConfigured(env)) return null;
  const res = await fetch(phoneEdge(env, 'messages'), {
    method: 'POST',
    headers: { ...authHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      ...(isUserId(target.to) ? { recipient: target.to } : { to: target.to }),
      ...payload,
    }),
  }).catch(() => null);
  if (!res?.ok) {
    const body = res ? ((await res.json().catch(() => null)) as { error?: { code?: number; message?: string } } | null) : null;
    createLogger(env, { scope: 'whatsapp' }).warn('send refused', { status: res?.status ?? 0, code: body?.error?.code, message: body?.error?.message?.slice(0, 200) });
    return null;
  }
  const data = (await res.json().catch(() => null)) as { messages?: Array<{ id?: string }> } | null;
  const id = data?.messages?.[0]?.id ?? null;
  if (id) await meterWhatsAppMessage(env, target.to, target.meter, id).catch(() => {});
  return id;
}

export async function sendWhatsAppText(env: Env, target: WhatsAppTarget, text: string): Promise<string | null> {
  let last: string | null = null;
  for (const chunk of chunkWhatsAppText(text)) {
    last = await sendMessage(env, target, { type: 'text', text: { body: chunk, preview_url: true } });
    if (!last) return null;
  }
  return last;
}

/** Up to three reply buttons (title ≤20 chars). The tap comes back as `button_reply.id`. */
export async function sendWhatsAppButtons(
  env: Env,
  target: WhatsAppTarget,
  body: string,
  buttons: Array<{ id: string; title: string }>,
): Promise<string | null> {
  return sendMessage(env, target, {
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: clip(body, MAX_INTERACTIVE_BODY) },
      action: {
        buttons: buttons.slice(0, MAX_BUTTONS).map((b) => ({ type: 'reply', reply: { id: b.id.slice(0, 256), title: clip(b.title, MAX_BUTTON_TITLE) } })),
      },
    },
  });
}

/** A list of up to ten rows behind one button. The pick comes back as `list_reply.id`. */
export async function sendWhatsAppList(
  env: Env,
  target: WhatsAppTarget,
  body: string,
  buttonLabel: string,
  rows: Array<{ id: string; title: string; description?: string }>,
): Promise<string | null> {
  return sendMessage(env, target, {
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: clip(body, MAX_TEXT_LEN) },
      action: {
        button: clip(buttonLabel, MAX_BUTTON_TITLE),
        sections: [{
          title: clip(buttonLabel, MAX_ROW_TITLE),
          rows: rows.slice(0, MAX_LIST_ROWS).map((r) => ({
            id: r.id.slice(0, 200),
            title: clip(r.title, MAX_ROW_TITLE),
            ...(r.description ? { description: clip(r.description, MAX_ROW_DESCRIPTION) } : {}),
          })),
        }],
      },
    },
  });
}

/** Upload bytes as media; returns the media id to send, or null. */
async function uploadMedia(env: Env, bytes: ArrayBuffer, filename: string, mime: string): Promise<string | null> {
  if (!whatsAppConfigured(env)) return null;
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mime);
  form.append('file', new Blob([bytes], { type: mime }), filename);
  const res = await fetch(phoneEdge(env, 'media'), {
    method: 'POST',
    headers: authHeaders(env),
    body: form,
  }).catch(() => null);
  if (!res?.ok) return null;
  const data = (await res.json().catch(() => null)) as { id?: string } | null;
  return data?.id ?? null;
}

export async function sendWhatsAppImage(env: Env, target: WhatsAppTarget, bytes: ArrayBuffer, filename: string, caption?: string): Promise<boolean> {
  const id = await uploadMedia(env, bytes, filename, 'image/png');
  if (!id) return false;
  return !!(await sendMessage(env, target, { type: 'image', image: { id, ...(caption ? { caption: clip(caption, MAX_INTERACTIVE_BODY) } : {}) } }));
}

export async function sendWhatsAppDocument(
  env: Env,
  target: WhatsAppTarget,
  bytes: ArrayBuffer,
  filename: string,
  mime: string,
  caption?: string,
): Promise<boolean> {
  const id = await uploadMedia(env, bytes, filename, mime);
  if (!id) return false;
  return !!(await sendMessage(env, target, {
    type: 'document',
    document: { id, filename, ...(caption ? { caption: clip(caption, MAX_INTERACTIVE_BODY) } : {}) },
  }));
}

/**
 * Mark their message read and show "typing…" until the reply lands (or 25 s pass).
 * Not a message, so it costs nothing.
 */
export async function markWhatsAppReadTyping(env: Env, messageId: string): Promise<void> {
  if (!whatsAppConfigured(env) || !messageId) return;
  await fetch(phoneEdge(env, 'messages'), {
    method: 'POST',
    headers: { ...authHeaders(env), 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId, typing_indicator: { type: 'text' } }),
  }).catch(() => {});
}

/** Download a media file someone sent (a voice note): media id → short-lived URL → bytes. */
export async function downloadWhatsAppMedia(env: Env, mediaId: string): Promise<ArrayBuffer | null> {
  if (!whatsAppConfigured(env)) return null;
  const meta = await fetch(graphUrl(env, `${encodeURIComponent(mediaId)}?phone_number_id=${env.WHATSAPP_PHONE_NUMBER_ID}`), {
    headers: authHeaders(env),
  }).catch(() => null);
  if (!meta?.ok) return null;
  const info = (await meta.json().catch(() => null)) as { url?: string } | null;
  // The file lives on Meta's CDN and needs the same token; never follow a URL off Meta.
  if (!info?.url || !/^https:\/\/[a-z0-9.-]+\.(?:fbsbx|facebook|whatsapp)\.(?:com|net)\//.test(info.url)) return null;
  const file = await fetch(info.url, { headers: authHeaders(env) }).catch(() => null);
  if (!file?.ok) return null;
  return file.arrayBuffer();
}
