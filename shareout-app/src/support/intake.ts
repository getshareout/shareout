import type { Env } from '../types';
import { createTicket, type CreateTicketInput, type Ticket } from './store';
import { triageTicket } from './triage';
import { notifySuperadmins } from '../superadmin/recipients';
import { getPlatformOrigin } from '../config/origins';

function baseUrl(env: Env): string {
  return getPlatformOrigin(env);
}

async function lookupEmail(env: Env, userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const row = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(userId).first<{ email: string }>();
  return row?.email ?? null;
}

/**
 * Single front door for every intake channel (bots, email, widget). Opens the ticket,
 * fills in the requester email when we only have a user id, then runs draft-only triage
 * and pings staff. Triage + alert are awaited best-effort so callers without an
 * ExecutionContext (bot webhooks) still complete the work before the request ends.
 */
export async function openTicket(env: Env, input: CreateTicketInput): Promise<Ticket> {
  if (!input.requesterEmail) {
    input = { ...input, requesterEmail: await lookupEmail(env, input.requesterUserId) };
  }
  const ticket = await createTicket(env, input);
  await triageTicket(env, ticket.id).catch(() => null);
  await notifySuperadmins(
    env,
    `🎫 New support ticket (${ticket.channel}): ${ticket.subject}\n${baseUrl(env)}/admin?view=support`
  ).catch(() => false);
  return ticket;
}
