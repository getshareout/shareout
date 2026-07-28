import type { FetchContext } from '../context';
import { jsonResponse, jsonError } from '../helpers/json-response';
import { getTokenOrSessionUser, requireTokenOrSession, isAuthUser } from '../helpers/auth-guard';
import { isSuperAdminEmail, notifySuperadmins } from '../../superadmin/recipients';
import { getInternalWorkspaceRole } from '../../workspaces/roles';
import {
  createTicket, getTicket, getThread, appendMessage, setStatus, assign,
  listForWorkspace, listAll, listForRequester,
  type Ticket, type TicketStatus,
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

/** Staff = a ShareOut super-admin, or an owner/admin of the ticket's workspace. */
async function isStaffFor(ctx: FetchContext, ticket: Ticket, user: { id: string; email: string | null }): Promise<boolean> {
  if (isSuperAdminEmail(user.email)) return true;
  if (!ticket.workspace_id) return false;
  const role = await getInternalWorkspaceRole(ctx.env, ticket.workspace_id, user.id);
  return role === 'owner' || role === 'admin';
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
      const body = await request.json().catch(() => null) as { subject?: string; body?: string; workspaceId?: string | null } | null;
      if (!body?.subject || !body?.body) return cors(jsonError('subject and body are required', 'BAD_REQUEST', 400));
      // Token caller → programmatic (skill); session caller → in-app UI.
      const viaToken = !!request.headers.get('authorization');
      const ticket = await createTicket(ctx.env, {
        workspaceId: body.workspaceId ?? null,
        requesterUserId: auth.id,
        requesterEmail: auth.email,
        channel: viaToken ? 'skill' : 'ui',
        subject: body.subject,
        body: body.body,
      });
      // Triage + staff alert run after the response — never block ticket creation.
      ctx.executionCtx?.waitUntil(triageTicket(ctx.env, ticket.id).catch(() => null));
      ctx.executionCtx?.waitUntil(
        notifySuperadmins(ctx.env, `🎫 New support ticket: ${ticket.subject}\n${ctx.url.origin}/admin?view=support`).catch(() => false)
      );
      return cors(jsonResponse({ success: true, ticket }, 201));
    }

    if (method === 'GET') {
      const scope = ctx.url.searchParams.get('scope') ?? 'mine';
      const status = ctx.url.searchParams.get('status') as TicketStatus | null;
      const filter = status && STATUSES.includes(status) ? { status } : {};
      if (scope === 'all') {
        if (!isSuperAdminEmail(auth.email)) return cors(jsonError('Forbidden', 'FORBIDDEN', 403));
        return cors(jsonResponse({ success: true, tickets: await listAll(ctx.env, filter) }));
      }
      if (scope === 'workspace') {
        const ws = ctx.url.searchParams.get('workspace');
        if (!ws) return cors(jsonError('workspace required', 'BAD_REQUEST', 400));
        const role = await getInternalWorkspaceRole(ctx.env, ws, auth.id);
        if (!isSuperAdminEmail(auth.email) && role !== 'owner' && role !== 'admin') {
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
