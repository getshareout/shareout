import type { FetchContext } from '../context';
import { jsonResponse, jsonError } from '../helpers/json-response';
import { requireTokenOrSession, isAuthUser } from '../helpers/auth-guard';
import type { AuthUser } from '../../api-auth';
import { isPlatformAdmin } from '../../superadmin/auth';
import { getInternalWorkspaceRole } from '../../workspaces/roles';
import {
  createTicket, getTicket, getThread, appendMessage, setStatus, assign,
  listForWorkspace, listAll, listForRequester, findByIdempotencyKey,
  TICKET_CATEGORIES, TICKET_SEVERITIES, TICKET_CLIENTS,
  type Ticket, type TicketStatus, type TicketCategory, type TicketSeverity, type TicketClient,
} from '../../support/store';
import { triageTicket } from '../../support/triage';
import { deliverReply } from '../../support/deliver';
import { ingestSupportEmail } from '../../support/email-ingest';
import { dispatchLifecycleEmail } from '../../email/gateway';

/** Constant-time-ish secret compare for the trusted email-gateway ingest. */
function secretOk(provided: string | null, expected: string | undefined): boolean {
  if (!expected || !provided) return false;
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < provided.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

const STATUSES: TicketStatus[] = ['open', 'pending', 'resolved', 'closed'];

/** Instance admin, by session or personal token. Workspace agent (sot_) tokens never count. */
async function isSuperAdmin(ctx: FetchContext, user: AuthUser): Promise<boolean> {
  return !user.service && await isPlatformAdmin(ctx.env, user.email, user.id);
}

/** Staff = an instance admin, or an owner/admin of the ticket's workspace. */
async function isStaffFor(ctx: FetchContext, ticket: Ticket, user: AuthUser): Promise<boolean> {
  if (await isSuperAdmin(ctx, user)) return true;
  if (!ticket.workspace_id) return false;
  const role = await getInternalWorkspaceRole(ctx.env, ticket.workspace_id, user.id);
  return role === 'owner' || role === 'admin';
}

interface CreateBody {
  subject?: string;
  body?: string;
  workspaceId?: string | null;
  category?: TicketCategory;
  severity?: TicketSeverity;
  client?: TicketClient;
  requestId?: string;
  pageUrl?: string;
  artifactId?: string;
  userAgent?: string;
  idempotencyKey?: string;
  locale?: string;
}

function invalidEnum(b: CreateBody): string | null {
  const checks: [string, unknown, readonly string[]][] = [
    ['category', b.category, TICKET_CATEGORIES],
    ['severity', b.severity, TICKET_SEVERITIES],
    ['client', b.client, TICKET_CLIENTS],
  ];
  for (const [name, value, allowed] of checks) {
    if (value != null && !allowed.includes(value as string)) return `${name} must be one of: ${allowed.join(', ')}`;
  }
  return null;
}

function clip(v: unknown, max: number): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
}

function created(ticket: Ticket, deduped: boolean) {
  const check = `/v1/support/tickets/${ticket.id}`;
  return {
    success: true,
    deduped,
    ticket,
    message: `Your report is in the support queue as ${ticket.id}. The team replies on the ticket thread`
      + ' (Help & support in the app) and by email — nothing else to do now.',
    check_replies: { method: 'GET', path: check, hint: 'Staff messages appear in `thread` with author "staff"; status turns "pending" once answered.' },
  };
}

export async function routeSupportApi(ctx: FetchContext): Promise<Response | null> {
  const { path, request } = ctx;
  if (!path.startsWith('/v1/support/')) return null;
  const method = request.method;
  const cors = (r: Response) => ctx.addCORS(r);

  // Trusted email-gateway ingest (AgentsEmail → here). Shared-secret, no user session:
  // turns an inbound support@ email into a tracked ticket, threading like the inbox handler.
  if (path === '/v1/support/ingest/email') {
    if (method !== 'POST') return cors(jsonError('Method not allowed', 'METHOD_NOT_ALLOWED', 405));
    if (!secretOk(request.headers.get('x-support-ingest-key'), ctx.env.SUPPORT_INGEST_KEY)) {
      return cors(jsonError('Forbidden', 'FORBIDDEN', 403));
    }
    const b = await request.json().catch(() => null) as { from?: string; subject?: string; body?: string } | null;
    if (!b?.from) return cors(jsonError('from is required', 'BAD_REQUEST', 400));
    const result = await ingestSupportEmail(ctx.env, { from: b.from, subject: b.subject, body: b.body });
    return cors(jsonResponse({ success: true, ...result }));
  }

  // ── Collection: create + list ──────────────────────────────────────────────
  if (path === '/v1/support/tickets') {
    const auth = await requireTokenOrSession(ctx);
    if (!isAuthUser(auth)) return auth;

    if (method === 'POST') {
      const body = await request.json().catch(() => null) as CreateBody | null;
      if (!body?.subject || !body?.body) return cors(jsonError('subject and body are required', 'BAD_REQUEST', 400));
      const bad = invalidEnum(body);
      if (bad) return cors(jsonError(bad, 'BAD_REQUEST', 400));
      const workspaceId = body.workspaceId || null;
      if (workspaceId && auth.service?.workspaceId !== workspaceId
        && !(await getInternalWorkspaceRole(ctx.env, workspaceId, auth.id))) {
        return cors(jsonError('You are not a member of that workspace. Omit workspaceId to file a personal ticket.', 'FORBIDDEN', 403));
      }
      const idempotencyKey = clip(body.idempotencyKey, 200);
      if (idempotencyKey) {
        const existing = await findByIdempotencyKey(ctx.env, auth.id, idempotencyKey);
        if (existing) return cors(jsonResponse(created(existing, true)));
      }
      // Token caller → programmatic (skill); session caller → in-app UI.
      const viaToken = !!request.headers.get('authorization');
      const ticket = await createTicket(ctx.env, {
        workspaceId,
        requesterUserId: auth.id,
        requesterEmail: auth.email,
        channel: viaToken ? 'skill' : 'ui',
        subject: body.subject.slice(0, 300),
        body: body.body,
        category: body.category ?? null,
        severity: body.severity ?? null,
        client: body.client ?? (viaToken ? 'api' : 'ui'),
        requestId: clip(body.requestId, 200),
        pageUrl: clip(body.pageUrl, 2000),
        artifactId: clip(body.artifactId, 200),
        userAgent: clip(body.userAgent ?? request.headers.get('user-agent'), 500),
        idempotencyKey,
        locale: body.locale === 'es' || body.locale === 'en' ? body.locale : null,
      });
      // Triage runs after the response — never block ticket creation.
      ctx.executionCtx?.waitUntil(triageTicket(ctx.env, ticket.id).catch(() => null));
      return cors(jsonResponse(created(ticket, false), 201));
    }

    if (method === 'GET') {
      const scope = ctx.url.searchParams.get('scope') ?? 'mine';
      const q = ctx.url.searchParams;
      const status = q.get('status') as TicketStatus | null;
      const filter = status && STATUSES.includes(status) ? { status } : {};
      if (scope === 'all') {
        if (!(await isSuperAdmin(ctx, auth))) return cors(jsonError('Forbidden', 'FORBIDDEN', 403));
        const since = q.get('since');
        if (since && Number.isNaN(Date.parse(since))) return cors(jsonError('since must be an ISO timestamp', 'BAD_REQUEST', 400));
        const limit = Math.min(Math.max(Number(q.get('limit')) || 200, 1), 500);
        const tickets = await listAll(ctx.env, {
          ...filter,
          workspace: q.get('workspace') || undefined,
          category: q.get('category') || undefined,
          since: since ? new Date(since).toISOString() : undefined,
          limit,
        });
        return cors(jsonResponse({ success: true, tickets }));
      }
      if (scope === 'workspace') {
        const ws = ctx.url.searchParams.get('workspace');
        if (!ws) return cors(jsonError('workspace required', 'BAD_REQUEST', 400));
        const role = await getInternalWorkspaceRole(ctx.env, ws, auth.id);
        if (role !== 'owner' && role !== 'admin' && !(await isSuperAdmin(ctx, auth))) {
          return cors(jsonError('Forbidden', 'FORBIDDEN', 403));
        }
        return cors(jsonResponse({ success: true, tickets: await listForWorkspace(ctx.env, ws, filter) }));
      }
      // mine: the requester's own tickets across channels.
      return cors(jsonResponse({ success: true, tickets: await listForRequester(ctx.env, auth.id, filter) }));
    }

    return cors(jsonError('Method not allowed', 'METHOD_NOT_ALLOWED', 405));
  }

  // ── Item: /v1/support/tickets/:id[/action] ─────────────────────────────────
  const m = path.match(/^\/v1\/support\/tickets\/([^/]+)(?:\/([a-z]+))?$/);
  if (!m) return null;
  const [, ticketId, action] = m;

  const auth = await requireTokenOrSession(ctx);
  if (!isAuthUser(auth)) return auth;
  const ticket = await getTicket(ctx.env, ticketId);
  if (!ticket) return cors(jsonError('Ticket not found', 'NOT_FOUND', 404));

  const isRequester = ticket.requester_user_id === auth.id;
  const staff = await isStaffFor(ctx, ticket, auth);
  if (!isRequester && !staff) return cors(jsonError('Forbidden', 'FORBIDDEN', 403));

  // GET ticket + thread
  if (!action && method === 'GET') {
    return cors(jsonResponse({ success: true, ticket, thread: await getThread(ctx.env, ticketId) }));
  }

  // Customer adds a message to their own ticket
  if (action === 'message' && method === 'POST') {
    const b = await request.json().catch(() => null) as { body?: string } | null;
    if (!b?.body) return cors(jsonError('body required', 'BAD_REQUEST', 400));
    const msg = await appendMessage(ctx.env, ticketId, isRequester && !staff ? 'customer' : 'staff', b.body);
    return cors(jsonResponse({ success: true, message: msg }));
  }

  // ── Staff-only actions below ───────────────────────────────────────────────
  if (!staff) return cors(jsonError('Forbidden', 'FORBIDDEN', 403));

  if (action === 'reply' && method === 'POST') {
    const b = await request.json().catch(() => null) as { body?: string } | null;
    if (!b?.body) return cors(jsonError('body required', 'BAD_REQUEST', 400));
    const result = await deliverReply(ctx.env, ticket, b.body);
    return cors(jsonResponse({ success: true, delivery: result }));
  }

  if (action === 'status' && method === 'POST') {
    const b = await request.json().catch(() => null) as { status?: TicketStatus } | null;
    if (!b?.status || !STATUSES.includes(b.status)) return cors(jsonError('valid status required', 'BAD_REQUEST', 400));
    await setStatus(ctx.env, ticketId, b.status);
    // Satisfaction note on resolve — only for requesters reachable by email.
    if (b.status === 'resolved' && ticket.requester_email) {
      ctx.executionCtx?.waitUntil(
        dispatchLifecycleEmail(ctx.env, {
          type: 'support_resolved',
          toUserId: ticket.requester_user_id ?? undefined,
          toEmail: ticket.requester_email,
          data: { subject: ticket.subject },
        }).then(() => undefined).catch(() => undefined)
      );
    }
    return cors(jsonResponse({ success: true }));
  }

  if (action === 'assign' && method === 'POST') {
    const b = await request.json().catch(() => null) as { assigneeUserId?: string | null } | null;
    await assign(ctx.env, ticketId, b?.assigneeUserId ?? null);
    return cors(jsonResponse({ success: true }));
  }

  if (action === 'triage' && method === 'POST') {
    const triage = await triageTicket(ctx.env, ticketId);
    if (!triage) return cors(jsonError('Triage unavailable', 'TRIAGE_FAILED', 502));
    return cors(jsonResponse({ success: true, triage }));
  }

  return cors(jsonError('Method not allowed', 'METHOD_NOT_ALLOWED', 405));
}
