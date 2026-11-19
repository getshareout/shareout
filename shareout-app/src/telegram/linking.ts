import type { Env } from '../types';
import type { TelegramWorkspaceSelection } from '../chat-agent/access';
import {
  consumeBotLinkCode,
  countBotLinks,
  getBotLinkedUserId,
  getBotSelectedWorkspace,
  linkBotSession,
  mintBotLinkCode,
  setBotSelectedWorkspace,
  unlinkBotSession,
} from '../chat-platforms/bot/links';

const BOT_USERNAME_KEY = 'tg:bot_username';

// Telegram's side of the shared bot links (chat-platforms/bot/links.ts): the session key and
// platform_user_id are both the chat id, which for a Telegram DM is the user.

export const mintLinkCode = (env: Env, userId: string): Promise<string | null> => mintBotLinkCode(env, 'telegram', userId);

export const consumeLinkCode = (env: Env, code: string): Promise<string | null> => consumeBotLinkCode(env, 'telegram', code);

export const linkChat = (env: Env, chatId: number, userId: string): Promise<void> =>
  linkBotSession(env, 'telegram', String(chatId), userId, String(chatId));

export const getLinkedUserId = (env: Env, chatId: number): Promise<string | null> => getBotLinkedUserId(env, 'telegram', String(chatId));

export const getSelectedTelegramWorkspace = (env: Env, chatId: number): Promise<TelegramWorkspaceSelection> =>
  getBotSelectedWorkspace(env, 'telegram', String(chatId));

export const setSelectedTelegramWorkspace = (env: Env, chatId: number, workspaceId: TelegramWorkspaceSelection): Promise<void> =>
  setBotSelectedWorkspace(env, 'telegram', String(chatId), workspaceId);

/** Resolve a user's linked Telegram chat (the most recently linked), or null. */
export async function getLinkedChatId(env: Env, userId: string): Promise<number | null> {
  const row = await env.DB.prepare(
    `SELECT session_key FROM messaging_links WHERE platform = 'telegram' AND user_id = ? ORDER BY linked_at DESC LIMIT 1`
  ).bind(userId).first<{ session_key: string }>();
  const n = row ? Number(row.session_key) : NaN;
  return Number.isFinite(n) ? n : null;
}

export const unlinkChat = (env: Env, chatId: number): Promise<void> => unlinkBotSession(env, 'telegram', String(chatId));

export const countLinkedChats = (env: Env, userId: string): Promise<number> => countBotLinks(env, 'telegram', userId);

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
