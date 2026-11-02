import type { Env } from '../../types';
import type { AuthUser } from '../../api-auth';
import type { FetchContext } from '../context';
import { isAuthUser, requireTokenOrSession } from '../helpers/auth-guard';
import { jsonWithApiErrors as json } from '../../http/api-error';
import { requireWorkspaceRole } from '../../workspaces/roles';
import { isPlatformAdmin } from '../../superadmin/auth';
import { logAudit } from '../../audit';
import {
  InvoiceInputError, MAX_FILE_BYTES, fileProblem, getInvoice, invoiceFileKey, invoiceView, isClosedMonth, isMonth, listInvoices,
  nextInvoiceNumber, parseCreateInvoice, safeFileName, totalCents, usageAlreadyBilled, usageForMonth, usageLine,
  type InvoiceRecord,
} from '../../workspaces/invoices';

// Workspace invoices (src/workspaces/invoices.ts). The instance operator (a platform admin)
// creates, issues, marks paid and attaches the receipt; the workspace's owners and admins see
// every invoice that left draft, download the receipt and attach their transfer proof.
//
//   GET    /v1/workspaces/{ws}/invoices                    list (+ can_manage)
//   POST   /v1/workspaces/{ws}/invoices                    create (operator)
//   GET    /v1/workspaces/{ws}/invoices/usage?month=…      a closed month's AI usage, to preview (operator)
//   PATCH  /v1/workspaces/{ws}/invoices/{id}               issue / paid / unpaid / void, notes, due date (operator)
//   DELETE /v1/workspaces/{ws}/invoices/{id}               a draft (operator)
//   PUT    /v1/workspaces/{ws}/invoices/{id}/receipt       the operator's receipt
//   PUT    /v1/workspaces/{ws}/invoices/{id}/proof         the workspace's transfer proof (admin+)
//   GET    /v1/workspaces/{ws}/invoices/{id}/receipt|proof download

const FORBIDDEN = { error: 'Forbidden', code: 'FORBIDDEN' };
const NOT_FOUND = { error: 'Invoice not found', code: 'NOT_FOUND' };

/** The instance operator. Agent tokens never manage invoices (the route guard refuses them too). */
async function canManage(env: Env, user: AuthUser): Promise<boolean> {
  return !user.service && (await isPlatformAdmin(env, user.email, user.id));
}

/** Who may read this workspace's invoices: the operator, or an internal owner/admin. Null = allowed. */
async function viewerGate(env: Env, user: AuthUser, workspaceId: string, manage: boolean): Promise<Response | null> {
  if (manage) return null;
  return requireWorkspaceRole(env, workspaceId, user.id, 'admin');
}

async function workspaceExists(env: Env, workspaceId: string): Promise<boolean> {
  return !!(await env.DB.prepare('SELECT id FROM workspaces WHERE id = ?').bind(workspaceId).first());
}

async function emailsFor(env: Env, rows: InvoiceRecord[]): Promise<Record<string, string>> {
  const ids = [...new Set(rows.map((r) => r.proof_uploaded_by).filter((x): x is string => !!x))];
  if (!ids.length) return {};
  const res = await env.DB.prepare(`SELECT id, email FROM users WHERE id IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids).all<{ id: string; email: string }>();
  return Object.fromEntries((res.results ?? []).map((r) => [r.id, r.email]));
}

const audit = (env: Env, user: AuthUser, workspaceId: string, action: string, inv: { id: string; number: string }, detail: Record<string, unknown> = {}) =>
  logAudit(env, { workspaceId, actorId: user.id, actorEmail: user.email, action, targetType: 'invoice', targetId: inv.id, detail: { number: inv.number, ...detail } });

export async function handleListInvoices(env: Env, user: AuthUser, workspaceId: string): Promise<Response> {
  const manage = await canManage(env, user);
  const gate = await viewerGate(env, user, workspaceId, manage);
  if (gate) return gate;
  const rows = await listInvoices(env, workspaceId, manage);
  const emails = await emailsFor(env, rows);
  return json({ invoices: rows.map((r) => invoiceView(r, emails)), can_manage: manage });
}

export async function handlePreviewUsage(request: Request, env: Env, user: AuthUser, workspaceId: string): Promise<Response> {
  if (!(await canManage(env, user))) return json(FORBIDDEN, 403);
  const month = new URL(request.url).searchParams.get('month');
  if (!isMonth(month)) return json({ error: 'month must be YYYY-MM', code: 'INVALID_MONTH' }, 400);
  if (!isClosedMonth(month)) return json({ error: `${month} has not closed yet`, code: 'USAGE_MONTH_OPEN' }, 400);
  const usage = await usageForMonth(env, workspaceId, month);
  return json({ usage, line: usageLine(usage), already_billed_in: await usageAlreadyBilled(env, workspaceId, month) });
}

export async function handleCreateInvoice(request: Request, env: Env, user: AuthUser, workspaceId: string): Promise<Response> {
  if (!(await canManage(env, user))) return json(FORBIDDEN, 403);
  if (!(await workspaceExists(env, workspaceId))) return json({ error: 'Workspace not found', code: 'NOT_FOUND' }, 404);

  let input;
  try {
    input = parseCreateInvoice(await request.json().catch(() => null));
  } catch (e) {
    if (e instanceof InvoiceInputError) return json({ error: e.message, code: e.code }, 400);
    throw e;
  }
  const lines = [...input.lines];
  if (input.usage_month) {
    if (!isClosedMonth(input.usage_month)) {
      return json({ error: `${input.usage_month} has not closed yet; bill its usage from the 1st of next month`, code: 'USAGE_MONTH_OPEN' }, 400);
    }
    const prior = await usageAlreadyBilled(env, workspaceId, input.usage_month);
    if (prior) return json({ error: `${input.usage_month} usage is already on invoice ${prior}; void it first`, code: 'USAGE_ALREADY_BILLED' }, 409);
    lines.push(usageLine(await usageForMonth(env, workspaceId, input.usage_month)));
  }
  const total = totalCents(lines);
  if (total < 0) return json({ error: 'The invoice total cannot be negative', code: 'VALIDATION_ERROR' }, 400);

  const id = `inv_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const now = new Date().toISOString();
  const issuedAt = input.status === 'open' ? now : null;
  // A custom number that is taken is the caller's mistake; an auto number can race another create, so retry it.
  for (let attempt = 0; attempt < 3; attempt++) {
    const number = input.number ?? (await nextInvoiceNumber(env));
    try {
      await env.DB.prepare(
        `INSERT INTO workspace_invoices (id, workspace_id, number, status, currency, total_cents, period_month, lines_json,
           notes, due_at, issued_at, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, workspaceId, number, input.status, input.currency, total, input.period_month, JSON.stringify(lines),
        input.notes, input.due_at, issuedAt, user.id, now, now).run();
    } catch (e) {
      if (!/UNIQUE/i.test(String(e))) throw e;
      if (input.number) return json({ error: `Invoice number ${number} is already used`, code: 'NUMBER_TAKEN' }, 409);
      continue;
    }
    await audit(env, user, workspaceId, input.status === 'open' ? 'invoice.issue' : 'invoice.create', { id, number }, { total_cents: total, currency: input.currency });
    const row = await getInvoice(env, workspaceId, id);
    return json({ invoice: invoiceView(row!) }, 201);
  }
  return json({ error: 'Could not allocate an invoice number; try again', code: 'NUMBER_TAKEN' }, 409);
}

// draft → open (issue) · open → paid · paid → open (undo) · draft|open → void
const TRANSITIONS: Record<string, string[]> = { draft: ['open', 'void'], open: ['paid', 'void'], paid: ['open'], void: [] };

export async function handleUpdateInvoice(request: Request, env: Env, user: AuthUser, workspaceId: string, id: string): Promise<Response> {
  if (!(await canManage(env, user))) return json(FORBIDDEN, 403);
  const inv = await getInvoice(env, workspaceId, id);
  if (!inv) return json(NOT_FOUND, 404);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return json({ error: 'Body must be a JSON object', code: 'VALIDATION_ERROR' }, 400);

  const sets: string[] = [];
  const binds: unknown[] = [];
  const set = (col: string, v: unknown) => { sets.push(`${col} = ?`); binds.push(v); };
  const text = (v: unknown, max: number) => (v == null || v === '' ? null : typeof v === 'string' && v.trim().length <= max ? v.trim() : undefined);

  if ('notes' in body) {
    const v = text(body.notes, 2000);
    if (v === undefined) return json({ error: 'notes must be a string of at most 2000 characters', code: 'VALIDATION_ERROR' }, 400);
    set('notes', v);
  }
  if ('due_at' in body) {
    const v = body.due_at;
    if (v != null && v !== '' && !(typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v))) {
      return json({ error: 'due_at must be YYYY-MM-DD', code: 'VALIDATION_ERROR' }, 400);
    }
    set('due_at', v ? `${v}T00:00:00.000Z` : null);
  }
  if ('payment_reference' in body) {
    const v = text(body.payment_reference, 200);
    if (v === undefined) return json({ error: 'payment_reference must be a string of at most 200 characters', code: 'VALIDATION_ERROR' }, 400);
    set('payment_reference', v);
  }

  const now = new Date().toISOString();
  let action: string | null = null;
  const to = body.status;
  if (to != null && to !== inv.status) {
    if (typeof to !== 'string' || !(TRANSITIONS[inv.status] ?? []).includes(to)) {
      return json({ error: `An invoice that is ${inv.status} cannot become ${String(to)}`, code: 'INVALID_TRANSITION' }, 409);
    }
    set('status', to);
    if (to === 'open' && inv.status === 'draft') { set('issued_at', now); action = 'invoice.issue'; }
    if (to === 'paid') {
      const paidAt = body.paid_at;
      if (paidAt != null && !(typeof paidAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(paidAt))) {
        return json({ error: 'paid_at must be YYYY-MM-DD', code: 'VALIDATION_ERROR' }, 400);
      }
      set('paid_at', paidAt ? `${paidAt}T00:00:00.000Z` : now);
      set('paid_by', user.id);
      action = 'invoice.paid';
    }
    if (to === 'open' && inv.status === 'paid') {
      set('paid_at', null); set('paid_by', null);
      action = 'invoice.unpaid';
    }
    if (to === 'void') action = 'invoice.void';
  } else if (inv.status === 'void' && sets.length) {
    return json({ error: 'A void invoice cannot be changed', code: 'INVALID_TRANSITION' }, 409);
  }
  if (!sets.length) return json({ invoice: invoiceView(inv) });

  set('updated_at', now);
  await env.DB.prepare(`UPDATE workspace_invoices SET ${sets.join(', ')} WHERE id = ? AND workspace_id = ?`)
    .bind(...binds, id, workspaceId).run();
  await audit(env, user, workspaceId, action ?? 'invoice.update', inv);
  const row = await getInvoice(env, workspaceId, id);
  return json({ invoice: invoiceView(row!, await emailsFor(env, [row!])) });
}

export async function handleDeleteInvoice(env: Env, user: AuthUser, workspaceId: string, id: string): Promise<Response> {
  if (!(await canManage(env, user))) return json(FORBIDDEN, 403);
  const inv = await getInvoice(env, workspaceId, id);
  if (!inv) return json(NOT_FOUND, 404);
  if (inv.status !== 'draft') return json({ error: 'Only a draft can be deleted; void an issued invoice instead', code: 'INVALID_TRANSITION' }, 409);
  await env.DB.prepare('DELETE FROM workspace_invoices WHERE id = ? AND workspace_id = ?').bind(id, workspaceId).run();
  for (const key of [inv.receipt_r2_key, inv.proof_r2_key]) {
    if (key) await env.ARTIFACTS.delete(key).catch(() => {});
  }
  await audit(env, user, workspaceId, 'invoice.delete', inv);
  return json({ deleted: true });
}

export async function handleUploadInvoiceFile(
  request: Request, env: Env, user: AuthUser, workspaceId: string, id: string, which: 'receipt' | 'proof',
): Promise<Response> {
  const manage = await canManage(env, user);
  if (which === 'receipt' && !manage) return json(FORBIDDEN, 403);
  const gate = await viewerGate(env, user, workspaceId, manage);
  if (gate) return gate;
  const inv = await getInvoice(env, workspaceId, id);
  if (!inv || (inv.status === 'draft' && !manage)) return json(NOT_FOUND, 404);
  if (inv.status === 'void') return json({ error: 'The invoice is void', code: 'INVALID_TRANSITION' }, 409);
  if (which === 'proof' && inv.status !== 'open' && !manage) {
    return json({ error: 'Transfer proof can only be attached while the invoice is unpaid', code: 'INVALID_TRANSITION' }, 409);
  }

  const contentType = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (Number(request.headers.get('Content-Length') || 0) > MAX_FILE_BYTES) {
    return json({ error: 'The file is larger than 10 MB', code: 'FILE_TOO_LARGE' }, 413);
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  const problem = fileProblem(contentType, bytes);
  if (problem) return json(problem, problem.code === 'FILE_TOO_LARGE' ? 413 : 400);

  const name = safeFileName(new URL(request.url).searchParams.get('name'), `${which}-${inv.number}`);
  const key = invoiceFileKey(workspaceId, id, which);
  await env.ARTIFACTS.put(key, bytes, { httpMetadata: { contentType } });
  const now = new Date().toISOString();
  if (which === 'receipt') {
    await env.DB.prepare('UPDATE workspace_invoices SET receipt_r2_key = ?, receipt_name = ?, receipt_type = ?, updated_at = ? WHERE id = ? AND workspace_id = ?')
      .bind(key, name, contentType, now, id, workspaceId).run();
  } else {
    await env.DB.prepare(`UPDATE workspace_invoices SET proof_r2_key = ?, proof_name = ?, proof_type = ?, proof_uploaded_by = ?,
        proof_uploaded_at = ?, updated_at = ? WHERE id = ? AND workspace_id = ?`)
      .bind(key, name, contentType, user.id, now, now, id, workspaceId).run();
  }
  await audit(env, user, workspaceId, `invoice.${which}`, inv, { name });
  const row = await getInvoice(env, workspaceId, id);
  return json({ invoice: invoiceView(row!, await emailsFor(env, [row!])) });
}

export async function handleDownloadInvoiceFile(env: Env, user: AuthUser, workspaceId: string, id: string, which: 'receipt' | 'proof'): Promise<Response> {
  const manage = await canManage(env, user);
  const gate = await viewerGate(env, user, workspaceId, manage);
  if (gate) return gate;
  const inv = await getInvoice(env, workspaceId, id);
  if (!inv || (inv.status === 'draft' && !manage)) return json(NOT_FOUND, 404);
  const file = which === 'receipt'
    ? { stored: inv.receipt_r2_key, name: inv.receipt_name, type: inv.receipt_type }
    : { stored: inv.proof_r2_key, name: inv.proof_name, type: inv.proof_type };
  const obj = file.stored ? await env.ARTIFACTS.get(file.stored) : null;
  if (!obj) return json({ error: `No ${which} attached`, code: 'NOT_FOUND' }, 404);
  const name = file.name || which;
  const type = file.type || 'application/octet-stream';
  // attachment + nosniff: an uploaded file is never rendered on the app origin.
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return new Response(obj.body, {
    headers: {
      'Content-Type': type,
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}

/** Router for /v1/workspaces/{ws}/invoices… — null when the path is not ours. */
export async function routeWorkspaceInvoices(ctx: FetchContext): Promise<Response | null> {
  const { request, env, path, addCORS } = ctx;
  const m = path.match(/^\/v1\/workspaces\/([^/]+)\/invoices(?:\/([^/]+))?(?:\/(receipt|proof))?$/);
  if (!m) return null;
  const user = await requireTokenOrSession(ctx);
  if (!isAuthUser(user)) return user;
  const workspaceId = decodeURIComponent(m[1]!);
  const sub = m[2] ? decodeURIComponent(m[2]) : null;
  const file = m[3] as 'receipt' | 'proof' | undefined;
  const method = request.method;

  if (!sub) {
    if (method === 'GET') return addCORS(await handleListInvoices(env, user, workspaceId));
    if (method === 'POST') return addCORS(await handleCreateInvoice(request, env, user, workspaceId));
  } else if (sub === 'usage' && !file) {
    if (method === 'GET') return addCORS(await handlePreviewUsage(request, env, user, workspaceId));
  } else if (file) {
    if (method === 'GET') return addCORS(await handleDownloadInvoiceFile(env, user, workspaceId, sub, file));
    if (method === 'PUT') return addCORS(await handleUploadInvoiceFile(request, env, user, workspaceId, sub, file));
  } else {
    if (method === 'PATCH') return addCORS(await handleUpdateInvoice(request, env, user, workspaceId, sub));
    if (method === 'DELETE') return addCORS(await handleDeleteInvoice(env, user, workspaceId, sub));
  }
  return addCORS(json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, 405));
}
