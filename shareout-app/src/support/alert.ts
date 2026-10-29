import type { Env } from '../types';
import { sendMessage as sendTelegram } from '../telegram/client';
import type { Ticket } from './store';

/**
 * Ping the instance operator on Telegram the moment a ticket opens, so a customer's
 * blocker reaches a human in minutes instead of waiting for someone to open the queue.
 * No-op unless SUPPORT_ALERT_TELEGRAM_CHAT_ID and TELEGRAM_BOT_TOKEN are set. Never throws.
 */
export async function alertOperator(env: Env, ticket: Ticket, body: string): Promise<boolean> {
  const excerpt = body.length > 1500 ? `${body.slice(0, 1500)}…` : body;
  return alertOps(env, `🆘 New support ticket ${ticket.id}`, [
    `Subject: ${ticket.subject}`,
    `From: ${ticket.requester_email ?? ticket.requester_user_id ?? 'unknown'}`,
    `Workspace: ${ticket.workspace_id ?? '—'} · via ${ticket.client ?? ticket.channel}`,
    ticket.severity ? `Severity: ${ticket.severity}` : '',
  ], excerpt);
}

/**
 * Ping the instance operator's Telegram chat (SUPPORT_ALERT_TELEGRAM_CHAT_ID) with a title,
 * a few detail lines and an optional body. No-op without the chat id and bot token. Never throws.
 */
export async function alertOps(env: Env, title: string, lines: string[], body?: string): Promise<boolean> {
  const chatId = Number(env.SUPPORT_ALERT_TELEGRAM_CHAT_ID);
  if (!env.SUPPORT_ALERT_TELEGRAM_CHAT_ID || !Number.isFinite(chatId) || !env.TELEGRAM_BOT_TOKEN) return false;
  const header = [title, ...lines].filter(Boolean).join('\n');
  try {
    await sendTelegram(env, chatId, body ? `${header}\n\n${body}` : header);
    return true;
  } catch {
    return false;
  }
}
