import type { Env } from '../types';
import { generateId } from '../crypto-utils';
import type { ChatMessage } from '../chat-agent/agent-loop';

export type TicketChannel = 'ui' | 'skill' | 'slack' | 'telegram' | 'email';
export type TicketStatus = 'open' | 'pending' | 'resolved' | 'closed';
export type TicketPriority = 'low' | 'normal' | 'high' | 'urgent';
export type MessageAuthor = 'customer' | 'staff' | 'ai';
export const TICKET_CATEGORIES = ['bug', 'question', 'access', 'billing', 'other'] as const;
export const TICKET_SEVERITIES = ['low', 'normal', 'high', 'blocker'] as const;
export const TICKET_CLIENTS = ['ui', 'claude', 'chatgpt', 'mcp', 'api', 'slack', 'telegram', 'email', 'chat_agent'] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];
export type TicketSeverity = (typeof TICKET_SEVERITIES)[number];
export type TicketClient = (typeof TICKET_CLIENTS)[number];
export type TicketLocale = 'en' | 'es';

export interface Ticket {
  id: string;
  workspace_id: string | null;
  requester_user_id: string | null;
  requester_email: string | null;
  channel: TicketChannel;
  channel_ref: string | null;
  subject: string;
  status: TicketStatus;
  priority: TicketPriority | null;
  category: string | null;
  assignee_user_id: string | null;
  ai_draft: string | null;
  ai_meta_json: string | null;
  sla_due: number | null;
  severity: TicketSeverity | null;
  request_id: string | null;
  page_url: string | null;
  artifact_id: string | null;
  user_agent: string | null;
  client: TicketClient | null;
  idempotency_key: string | null;
  locale: TicketLocale | null;
  created_at: string;
  updated_at: string;
  last_msg_at: string;
}

export interface TicketMessage {
  id: string;
  ticket_id: string;
  author: MessageAuthor;
  body: string;
  created_at: string;
}

export interface CreateTicketInput {
  workspaceId?: string | null;
  requesterUserId?: string | null;
  requesterEmail?: string | null;
  channel: TicketChannel;
  channelRef?: string | null;
  subject: string;
  body: string;
  category?: TicketCategory | null;
  severity?: TicketSeverity | null;
  requestId?: string | null;
  pageUrl?: string | null;
  artifactId?: string | null;
  userAgent?: string | null;
  client?: TicketClient | null;
  idempotencyKey?: string | null;
  locale?: TicketLocale | null;
}

/** Open a new ticket and seed it with the customer's first message. */
export async function createTicket(env: Env, input: CreateTicketInput): Promise<Ticket> {
  const now = new Date().toISOString();
  const id = generateId('tkt');
  await env.DB.prepare(
    `INSERT INTO tickets (id, workspace_id, requester_user_id, requester_email, channel, channel_ref,
       subject, status, category, severity, request_id, page_url, artifact_id, user_agent, client,
       idempotency_key, locale, created_at, updated_at, last_msg_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    input.workspaceId ?? null,
    input.requesterUserId ?? null,
    input.requesterEmail ?? null,
    input.channel,
    input.channelRef ?? null,
    input.subject,
    input.category ?? null,
    input.severity ?? null,
    input.requestId ?? null,
    input.pageUrl ?? null,
    input.artifactId ?? null,
    input.userAgent ?? null,
    input.client ?? null,
    input.idempotencyKey ?? null,
    input.locale ?? null,
    now, now, now,
  ).run();
  await appendMessage(env, id, 'customer', input.body);
  return (await getTicket(env, id))!;
}

/** Append a message to a ticket thread and bump lifecycle timestamps/status. */
export async function appendMessage(env: Env, ticketId: string, author: MessageAuthor, body: string): Promise<TicketMessage> {
  const now = new Date().toISOString();
  const msg: TicketMessage = { id: generateId('tmsg'), ticket_id: ticketId, author, body, created_at: now };
  await env.DB.prepare(
    `INSERT INTO ticket_messages (id, ticket_id, author, body, created_at) VALUES (?, ?, ?, ?, ?)`
  ).bind(msg.id, ticketId, author, body, now).run();
  // A customer reply reopens the conversation; a staff reply moves it to pending.
  const statusBump = author === 'customer' ? `status = 'open', ` : author === 'staff' ? `status = 'pending', ` : '';
  await env.DB.prepare(
    `UPDATE tickets SET ${statusBump}last_msg_at = ?, updated_at = ? WHERE id = ?`
  ).bind(now, now, ticketId).run();
  return msg;
}

export async function getTicket(env: Env, ticketId: string): Promise<Ticket | null> {
  return await env.DB.prepare(`SELECT * FROM tickets WHERE id = ?`).bind(ticketId).first<Ticket>();
}

export async function findByIdempotencyKey(env: Env, requesterUserId: string, key: string): Promise<Ticket | null> {
  return await env.DB.prepare(`SELECT * FROM tickets WHERE requester_user_id = ? AND idempotency_key = ?`)
    .bind(requesterUserId, key).first<Ticket>();
}

export async function getThread(env: Env, ticketId: string): Promise<TicketMessage[]> {
  const rows = await env.DB.prepare(
    `SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY created_at ASC`
  ).bind(ticketId).all<TicketMessage>();
  return rows.results;
}

/** Thread as ChatMessage[] for the triage model (customer→user, staff/ai→assistant). */
export async function threadAsChatHistory(env: Env, ticketId: string): Promise<ChatMessage[]> {
  const thread = await getThread(env, ticketId);
  return thread.map((m) => ({ role: m.author === 'customer' ? 'user' : 'assistant', content: m.body }));
}

export async function setStatus(env: Env, ticketId: string, status: TicketStatus): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(`UPDATE tickets SET status = ?, updated_at = ? WHERE id = ?`)
    .bind(status, now, ticketId).run();
}

export async function assign(env: Env, ticketId: string, assigneeUserId: string | null): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(`UPDATE tickets SET assignee_user_id = ?, updated_at = ? WHERE id = ?`)
    .bind(assigneeUserId, now, ticketId).run();
}

export interface Triage {
  category: string;
  priority: TicketPriority;
  draft: string;
}

/** Store triage output on the ticket. Draft is never auto-sent — staff approve it.
 *  A category the reporter chose is kept; triage only fills an empty one. */
export async function setTriage(env: Env, ticketId: string, t: Triage): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE tickets SET category = COALESCE(category, ?), priority = ?, ai_draft = ?, ai_meta_json = ?, updated_at = ? WHERE id = ?`
  ).bind(t.category, t.priority, t.draft, JSON.stringify(t), now, ticketId).run();
}

/** Close resolved tickets that have sat idle past the window. Daily housekeeping. */
export async function autoCloseIdleTickets(env: Env, idleDays = 7): Promise<number> {
  const cutoff = new Date(Date.now() - idleDays * 24 * 60 * 60 * 1000).toISOString();
  const res = await env.DB.prepare(
    `UPDATE tickets SET status = 'closed', updated_at = ? WHERE status = 'resolved' AND last_msg_at < ?`
  ).bind(new Date().toISOString(), cutoff).run();
  return res.meta?.changes ?? 0;
}

export interface ListFilter {
  status?: TicketStatus;
  limit?: number;
}

export interface AllFilter extends ListFilter {
  /** A workspace id, or 'none' for tickets with no workspace. */
  workspace?: string;
  category?: string;
  /** ISO timestamp: only tickets with a message after it. */
  since?: string;
}

/** Tickets for one workspace (personal scope = workspace_id IS NULL). */
export async function listForWorkspace(env: Env, workspaceId: string | null, filter: ListFilter = {}): Promise<Ticket[]> {
  const wsClause = workspaceId === null ? 'workspace_id IS NULL' : 'workspace_id = ?';
  const wsBind = workspaceId === null ? [] : [workspaceId];
  const statusClause = filter.status ? ' AND status = ?' : '';
  const statusBind = filter.status ? [filter.status] : [];
  const rows = await env.DB.prepare(
    `SELECT * FROM tickets WHERE ${wsClause}${statusClause} ORDER BY last_msg_at DESC LIMIT ?`
  ).bind(...wsBind, ...statusBind, filter.limit ?? 100).all<Ticket>();
  return rows.results;
}

/** All tickets across every workspace — super-admin only. */
export async function listAll(env: Env, filter: AllFilter = {}): Promise<Ticket[]> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (filter.status) { where.push('status = ?'); binds.push(filter.status); }
  if (filter.workspace === 'none') where.push('workspace_id IS NULL');
  else if (filter.workspace) { where.push('workspace_id = ?'); binds.push(filter.workspace); }
  if (filter.category) { where.push('category = ?'); binds.push(filter.category); }
  if (filter.since) { where.push('last_msg_at > ?'); binds.push(filter.since); }
  const rows = await env.DB.prepare(
    `SELECT * FROM tickets ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY last_msg_at DESC LIMIT ?`
  ).bind(...binds, filter.limit ?? 200).all<Ticket>();
  return rows.results;
}

/** Most recent still-open ticket from an email requester, for threading inbound replies. */
export async function findLatestOpenTicketByEmail(env: Env, email: string): Promise<Ticket | null> {
  return await env.DB.prepare(
    `SELECT * FROM tickets WHERE requester_email = ? AND channel = 'email' AND status IN ('open','pending')
       ORDER BY last_msg_at DESC, rowid DESC LIMIT 1`
  ).bind(email).first<Ticket>();
}

/** Tickets a given requester opened (for the customer-facing /app/support list). */
export async function listForRequester(env: Env, userId: string, filter: ListFilter = {}): Promise<Ticket[]> {
  const rows = await env.DB.prepare(
    `SELECT * FROM tickets WHERE requester_user_id = ? ORDER BY last_msg_at DESC LIMIT ?`
  ).bind(userId, filter.limit ?? 100).all<Ticket>();
  return rows.results;
}
