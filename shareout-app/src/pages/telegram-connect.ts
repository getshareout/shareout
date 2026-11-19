import type { Env } from '../types';
import { countLinkedChats, getBotUsername, mintLinkCode } from '../telegram/linking';
import { renderChatConnectPage, type ChatConnectUser } from './chat-connect';

const telegramLink = (username: string, code: string) =>
  `https://t.me/${encodeURIComponent(username)}?start=${encodeURIComponent(code)}`;

/** Mint a fresh link code and 302 straight to the Telegram bot deep link, skipping
 *  the intermediate settings page. Falls back to null when the bot isn't available. */
export async function telegramDeepLinkRedirect(env: Env, user: ChatConnectUser): Promise<Response | null> {
  const [code, username] = await Promise.all([mintLinkCode(env, user.id), getBotUsername(env)]);
  if (!username || !code) return null;
  return Response.redirect(telegramLink(username, code), 302);
}

export async function renderTelegramConnectPage(env: Env, user: ChatConnectUser): Promise<Response> {
  const [linkedCount, code, username] = await Promise.all([
    countLinkedChats(env, user.id),
    mintLinkCode(env, user.id),
    getBotUsername(env),
  ]);
  return renderChatConnectPage(env, user, {
    app: 'Telegram',
    href: username && code ? telegramLink(username, code) : null,
    linked: linkedCount > 0,
  });
}
