import type { Env } from '../types';
import { countBotLinks, mintBotLinkCode } from '../chat-platforms/bot/links';
import { whatsAppConfigured } from '../whatsapp/client';
import { chatConnectLocale, renderChatConnectPage, type ChatConnectUser } from './chat-connect';
import { t } from '../i18n';

const PREFILL = {
  en: (code: string) => `Connect my ShareOut account: ${code}`,
  es: (code: string) => `Conectar mi cuenta de ShareOut: ${code}`,
};

/**
 * The wa.me link that opens a chat with the bot, the one-time code already typed: the
 * person only taps Send. Null when WhatsApp is not set up here.
 */
async function whatsappLink(env: Env, user: ChatConnectUser): Promise<string | null> {
  const number = (env.WHATSAPP_BUSINESS_NUMBER || '').replace(/\D/g, '');
  if (!number || !whatsAppConfigured(env)) return null;
  const code = await mintBotLinkCode(env, 'whatsapp', user.id);
  if (!code) return null;
  const text = t(await chatConnectLocale(env, user), PREFILL)(code);
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

/** Straight to WhatsApp with a fresh code; null (show the page) when it is unavailable. */
export async function whatsappDeepLinkRedirect(env: Env, user: ChatConnectUser): Promise<Response | null> {
  const href = await whatsappLink(env, user);
  return href ? Response.redirect(href, 302) : null;
}

export async function renderWhatsAppConnectPage(env: Env, user: ChatConnectUser): Promise<Response> {
  const [href, links] = await Promise.all([whatsappLink(env, user), countBotLinks(env, 'whatsapp', user.id).catch(() => 0)]);
  return renderChatConnectPage(env, user, { app: 'WhatsApp', href, linked: links > 0 });
}
