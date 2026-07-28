import type { Env } from '../types';
import { TELEGRAM_PERSONAL_WORKSPACE, type TelegramWorkspaceSelection } from '../chat-agent/access';

const LINK_CODE_PREFIX = 'tg:link:';
const LINK_CODE_TTL_SECONDS = 900; // 15 minutes
const BOT_USERNAME_KEY = 'tg:bot_username';

function randomCode(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Mint a one-time linking code bound to a user. Null if KV is unbound.
export async function mintLinkCode(env: Env, userId: string): Promise<string | null> {
  if (!env.RATE_LIMIT_KV) return null;
  const code = randomCode();
  await env.RATE_LIMIT_KV.put(LINK_CODE_PREFIX + code, userId, { expirationTtl: LINK_CODE_TTL_SECONDS });
  return code;
}

// Consume a code: return the bound userId and delete it (one-time use).
export async function consumeLinkCode(env: Env, code: string): Promise<string | null> {
  if (!env.RATE_LIMIT_KV) return null;
  const key = LINK_CODE_PREFIX + code;
  const userId = await env.RATE_LIMIT_KV.get(key);
  if (!userId) return null;
  await env.RATE_LIMIT_KV.delete(key);
  return userId;
}

// Telegram links live in `messaging_links` alongside Slack: session_key and
// platform_user_id are both the chat id, which for a Telegram DM is the user.
export async function linkChat(env: Env, chatId: number, userId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO messaging_links (platform, session_key, user_id, platform_user_id, linked_at)
     VALUES ('telegram', ?, ?, ?, ?)`
  ).bind(String(chatId), userId, String(chatId), new Date().toISOString()).run();
}

export async function getLinkedUserId(env: Env, chatId: number): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT user_id FROM messaging_links WHERE platform = 'telegram' AND session_key = ?`
  ).bind(String(chatId)).first<{ user_id: string }>();
  return row?.user_id ?? null;
}

export async function getSelectedTelegramWorkspace(
  env: Env,
  chatId: number
): Promise<TelegramWorkspaceSelection> {
  try {
    const row = await env.DB.prepare(
      `SELECT selected_workspace_id FROM messaging_links WHERE platform = 'telegram' AND session_key = ?`
    ).bind(String(chatId)).first<{ selected_workspace_id: string | null }>();
    return row?.selected_workspace_id ?? null;
  } catch {
    // The deploy can briefly run before the D1 migration is applied. Defaulting
    // to "all" keeps the bot usable instead of breaking every chat turn.
    return null;
  }
}

export async function setSelectedTelegramWorkspace(
  env: Env,
  chatId: number,
  workspaceId: TelegramWorkspaceSelection
): Promise<void> {
  const selected = workspaceId === TELEGRAM_PERSONAL_WORKSPACE ? TELEGRAM_PERSONAL_WORKSPACE : workspaceId;
  try {
    await env.DB.prepare(
      `UPDATE messaging_links SET selected_workspace_id = ? WHERE platform = 'telegram' AND session_key = ?`
    ).bind(selected, String(chatId)).run();
  } catch {
    // See getSelectedTelegramWorkspace.
  }
}

/** Resolve a user's linked Telegram chat (the most recently linked), or null. */
export async function getLinkedChatId(env: Env, userId: string): Promise<number | null> {
  const row = await env.DB.prepare(
    `SELECT session_key FROM messaging_links WHERE platform = 'telegram' AND user_id = ? ORDER BY linked_at DESC LIMIT 1`
  ).bind(userId).first<{ session_key: string }>();
  const n = row ? Number(row.session_key) : NaN;
  return Number.isFinite(n) ? n : null;
}

export async function unlinkChat(env: Env, chatId: number): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM messaging_links WHERE platform = 'telegram' AND session_key = ?`
  ).bind(String(chatId)).run();
}

export async function countLinkedChats(env: Env, userId: string): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM messaging_links WHERE platform = 'telegram' AND user_id = ?`
  ).bind(userId).first<{ n: number }>();
  return row?.n ?? 0;
}

// Resolve the bot's @username via getMe, cached in KV (it doesn't change).
export async function getBotUsername(env: Env): Promise<string | null> {
  if (!env.TELEGRAM_BOT_TOKEN) return null;
  if (env.RATE_LIMIT_KV) {
    const cached = await env.RATE_LIMIT_KV.get(BOT_USERNAME_KEY);
    if (cached) return cached;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getMe`);
    const body = (await res.json()) as { ok: boolean; result?: { username?: string } };
    const username = body.result?.username ?? null;
    if (username && env.RATE_LIMIT_KV) {
      await env.RATE_LIMIT_KV.put(BOT_USERNAME_KEY, username, { expirationTtl: 86400 });
    }
    return username;
  } catch {
    return null;
  }
}
