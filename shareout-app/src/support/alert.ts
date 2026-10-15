import type { Env } from '../types';
import { sendMessage as sendTelegram } from '../telegram/client';
import type { Ticket } from './store';

/**
 * Ping the instance operator on Telegram the moment a ticket opens, so a customer's
 * blocker reaches a human in minutes instead of waiting for someone to open the queue.
 * No-op unless SUPPORT_ALERT_TELEGRAM_CHAT_ID and TELEGRAM_BOT_TOKEN are set. Never throws.
 */
export async function alertOperator(env: Env, ticket: Ticket, body: string): Promise<boolean> {
  const chatId = Number(env.SUPPORT_ALERT_TELEGRAM_CHAT_ID);
  if (!env.SUPPORT_ALERT_TELEGRAM_CHAT_ID || !Number.isFinite(chatId) || !env.TELEGRAM_BOT_TOKEN) return false;
  const header = [
    `🆘 New support ticket ${ticket.id}`,
    `Subject: ${ticket.subject}`,
    `From: ${ticket.requester_email ?? ticket.requester_user_id ?? 'unknown'}`,
    `Workspace: ${ticket.workspace_id ?? '—'} · via ${ticket.client ?? ticket.channel}`,
    ticket.severity ? `Severity: ${ticket.severity}` : '',
  ].filter(Boolean).join('\n');
  const excerpt = body.length > 1500 ? `${body.slice(0, 1500)}…` : body;
  try {
    await sendTelegram(env, chatId, `${header}\n\n${excerpt}`);
    return true;
  } catch {
    return false;
  }
}
