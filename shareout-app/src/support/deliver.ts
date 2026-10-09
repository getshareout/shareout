import type { Env } from '../types';
import { dispatchLifecycleEmail } from '../email/gateway';
import { sendMessage as sendTelegram } from '../telegram/client';
import { getPlatformOrigin } from '../config/origins';
import { appendMessage, type Ticket } from './store';

export interface DeliverResult {
  delivered: boolean;
  via: Ticket['channel'];
  error?: string;
}

/** Bell row for a requester who has an account, whatever channel the ticket came in on. */
async function notifyRequester(env: Env, ticket: Ticket): Promise<void> {
  if (!ticket.requester_user_id) return;
  await env.DB.prepare(
    `INSERT INTO notifications (id, recipient_type, recipient_id, kind, subject_type, subject_id, message)
     VALUES (?, 'user', ?, 'support_reply', 'ticket', ?, ?)`
  ).bind(crypto.randomUUID(), ticket.requester_user_id, ticket.id, ticket.subject).run().catch(() => {});
}

/**
 * Send a staff reply out on the ticket's origin channel and record it in the thread.
 * The message is always appended (so it shows in the admin + customer thread) even if
 * outbound delivery to an external channel fails — the failure is reported back.
 */
export async function deliverReply(env: Env, ticket: Ticket, body: string): Promise<DeliverResult> {
  await appendMessage(env, ticket.id, 'staff', body);
  await notifyRequester(env, ticket);

  switch (ticket.channel) {
    case 'ui':
    case 'skill': {
      // In-app + API requesters answer from their thread; the email tells them a reply is there.
      if (!ticket.requester_email && !ticket.requester_user_id) return { delivered: false, via: ticket.channel, error: 'no requester' };
      const res = await dispatchLifecycleEmail(env, {
        type: 'support_reply',
        toUserId: ticket.requester_user_id ?? undefined,
        toEmail: ticket.requester_email ?? undefined,
        data: { subject: ticket.subject, body, ticketUrl: `${getPlatformOrigin(env)}/home#help`, locale: ticket.locale ?? undefined },
      });
      return { delivered: res.sent, via: ticket.channel, error: res.error ?? res.skipped };
    }

    case 'email': {
      if (!ticket.requester_email) return { delivered: false, via: 'email', error: 'no requester email' };
      const res = await dispatchLifecycleEmail(env, {
        type: 'support_reply',
        toUserId: ticket.requester_user_id ?? undefined,
        toEmail: ticket.requester_email,
        data: { subject: ticket.subject, body, locale: ticket.locale ?? undefined },
      });
      return { delivered: res.sent, via: 'email', error: res.error };
    }

    case 'telegram': {
      const chatId = Number(ticket.channel_ref);
      if (!ticket.channel_ref || Number.isNaN(chatId)) return { delivered: false, via: 'telegram', error: 'no chat id' };
      try {
        await sendTelegram(env, chatId, body);
        return { delivered: true, via: 'telegram' };
      } catch (e) {
        return { delivered: false, via: 'telegram', error: e instanceof Error ? e.message : 'send failed' };
      }
    }

    case 'slack': {
      // channel_ref stores "teamId:channelId" captured at intake.
      const [teamId, channelId] = (ticket.channel_ref ?? '').split(':');
      if (!teamId || !channelId) return { delivered: false, via: 'slack', error: 'no slack ref' };
      try {
        const { resolveSlackTokenByTeam, postSlackMessage } = await import('../chat-platforms/slack/client');
        const resolved = await resolveSlackTokenByTeam(env, teamId);
        if (!resolved) return { delivered: false, via: 'slack', error: 'no slack token' };
        await postSlackMessage(resolved.token, channelId, body);
        return { delivered: true, via: 'slack' };
      } catch (e) {
        return { delivered: false, via: 'slack', error: e instanceof Error ? e.message : 'send failed' };
      }
    }

    default:
      return { delivered: false, via: ticket.channel, error: 'unknown channel' };
  }
}
