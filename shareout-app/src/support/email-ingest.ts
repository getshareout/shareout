import type { Env } from '../types';
import { openTicket } from './intake';
import { findLatestOpenTicketByEmail, appendMessage } from './store';

export interface IngestEmailInput {
  from: string;
  subject?: string | null;
  body?: string | null;
}

export interface IngestResult {
  ticketId: string;
  threaded: boolean;
}

/**
 * Turn an inbound support email into a ticket: thread onto the sender's most recent
 * open ticket, otherwise open a new one. Shared by the inbox-domain handler and the
 * trusted email-gateway ingest endpoint so both behave identically.
 */
export async function ingestSupportEmail(env: Env, input: IngestEmailInput): Promise<IngestResult> {
  const from = input.from.trim().toLowerCase();
  const subjectRaw = (input.subject || 'Support request').replace(/^\s*re:\s*/i, '').trim() || 'Support request';
  const subject = subjectRaw.length > 120 ? subjectRaw.slice(0, 117) + '…' : subjectRaw;
  const body = (input.body || '').trim() || '(no message body)';

  const existing = await findLatestOpenTicketByEmail(env, from);
  if (existing) {
    await appendMessage(env, existing.id, 'customer', body);
    return { ticketId: existing.id, threaded: true };
  }
  const ticket = await openTicket(env, { requesterEmail: from, channel: 'email', channelRef: from, subject, body });
  return { ticketId: ticket.id, threaded: false };
}
