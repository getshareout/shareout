import type { Env } from '../types';

const API_BASE = 'https://api.telegram.org';
// Telegram rejects messages longer than 4096 chars; chunk below that.
const MAX_MESSAGE_LEN = 4000;

function apiUrl(env: Env, method: string, botToken?: string): string {
  return `${API_BASE}/bot${botToken || env.TELEGRAM_BOT_TOKEN}/${method}`;
}

// Split on paragraph/line boundaries where possible so chunks read naturally.
function chunkText(text: string): string[] {
  if (text.length <= MAX_MESSAGE_LEN) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > MAX_MESSAGE_LEN) {
    let cut = rest.lastIndexOf('\n', MAX_MESSAGE_LEN);
    if (cut < MAX_MESSAGE_LEN * 0.5) cut = MAX_MESSAGE_LEN;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, '');
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export async function sendMessage(env: Env, chatId: number, text: string, botToken?: string): Promise<void> {
  if (!(botToken || env.TELEGRAM_BOT_TOKEN)) return;
  for (const chunk of chunkText(text)) {
    await fetch(apiUrl(env, 'sendMessage', botToken), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: chunk }),
    });
  }
}

/** Resolve a file_id to a downloadable file_path via the Bot API. */
export async function getFilePath(env: Env, fileId: string): Promise<string | null> {
  if (!env.TELEGRAM_BOT_TOKEN) return null;
  const res = await fetch(apiUrl(env, 'getFile'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_id: fileId }),
  });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as { result?: { file_path?: string } } | null;
  return data?.result?.file_path ?? null;
}

/** Download a resolved file_path's bytes. Files live under api.telegram.org/file/bot<token>/<path>. */
export async function downloadFile(env: Env, filePath: string): Promise<ArrayBuffer | null> {
  if (!env.TELEGRAM_BOT_TOKEN) return null;
  const url = `${API_BASE}/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.arrayBuffer();
}

export async function sendChatAction(env: Env, chatId: number, action = 'typing'): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  await fetch(apiUrl(env, 'sendChatAction'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action }),
  });
}

// Telegram caps captions at 1024 chars.
const MAX_CAPTION_LEN = 1024;

/** Send an image as a Telegram photo (compressed inline preview). Returns ok. */
export async function sendPhoto(
  env: Env,
  chatId: number,
  bytes: ArrayBuffer,
  filename: string,
  caption?: string,
  botToken?: string
): Promise<boolean> {
  if (!(botToken || env.TELEGRAM_BOT_TOKEN)) return false;
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (caption) form.append('caption', caption.slice(0, MAX_CAPTION_LEN));
  form.append('photo', new Blob([bytes], { type: 'image/png' }), filename);
  const res = await fetch(apiUrl(env, 'sendPhoto', botToken), { method: 'POST', body: form });
  return res.ok;
}

/** Send a file as a Telegram document (preserves the original bytes, no compression). Returns ok. */
export async function sendDocument(
  env: Env,
  chatId: number,
  bytes: ArrayBuffer,
  filename: string,
  mimeType: string,
  caption?: string
): Promise<boolean> {
  if (!env.TELEGRAM_BOT_TOKEN) return false;
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (caption) form.append('caption', caption.slice(0, MAX_CAPTION_LEN));
  form.append('document', new Blob([bytes], { type: mimeType }), filename);
  const res = await fetch(apiUrl(env, 'sendDocument'), { method: 'POST', body: form });
  return res.ok;
}

export type InlineButton =
  | {
  text: string;
  callback_data: string;
  }
  | {
    text: string;
    url: string;
  };

/** Send a message with inline-keyboard buttons. Returns the sent message_id (for later editing). */
export async function sendMessageWithButtons(
  env: Env,
  chatId: number,
  text: string,
  buttons: InlineButton[][]
): Promise<number | null> {
  if (!env.TELEGRAM_BOT_TOKEN) return null;
  const res = await fetch(apiUrl(env, 'sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text.slice(0, MAX_MESSAGE_LEN), reply_markup: { inline_keyboard: buttons } }),
  });
  if (!res.ok) return null;
  const data = (await res.json().catch(() => null)) as { result?: { message_id?: number } } | null;
  return data?.result?.message_id ?? null;
}

/** Replace a message's text and drop its inline keyboard — used to resolve an approval prompt. */
export async function editMessageText(env: Env, chatId: number, messageId: number, text: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  await fetch(apiUrl(env, 'editMessageText'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, text: text.slice(0, MAX_MESSAGE_LEN), reply_markup: { inline_keyboard: [] } }),
  });
}

/** Acknowledge a button tap (clears Telegram's loading spinner). */
export async function answerCallbackQuery(env: Env, callbackQueryId: string, text?: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) return;
  await fetch(apiUrl(env, 'answerCallbackQuery'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId, ...(text ? { text } : {}) }),
  });
}

export { chunkText };
