import type { DataContext } from '../middleware';
import { errorResponse, successResponse, verifyOwner } from '../middleware';
import { DATA_ERRORS } from '../../types';
import { Errors } from '../errors';
import { isFreeMailDomain } from '../../delivery/destinations/email-sheet-sync';
import {
  getInboxStatus,
  enableInbound,
  disableInbound,
  setInboundAllowlist,
  listInboxMessages,
  getInboxMessage,
  type InboxMessageRow,
  type StoredAttachment,
} from '../../email/inbox-store';

// Management surface for an artifact's inbound inbox. Every route, reads included,
// requires owner/editor (verifyOwner): messages hold third-party mail and attachments.

function serializeMessage(row: InboxMessageRow, full: boolean) {
  let attachments: { filename: string; contentType: string; size: number; index: number }[] = [];
  if (row.attachments_json) {
    try {
      attachments = (JSON.parse(row.attachments_json) as StoredAttachment[]).map((a, index) => ({
        filename: a.filename, contentType: a.contentType, size: a.size, index,
      }));
    } catch { /* ignore */ }
  }
  return {
    id: row.id,
    rfcMessageId: row.message_id,
    from: row.from_addr,
    to: row.to_addr,
    tag: row.tag,
    subject: row.subject,
    ...(full
      ? { text: row.text_body, html: row.html_body }
      : { textPreview: (row.text_body || '').slice(0, 280), hasHtml: Boolean(row.html_body) }),
    auth: { spf: row.spf, dkim: row.dkim, dmarc: row.dmarc },
    attachments,
    sizeBytes: row.size_bytes,
    receivedAt: row.received_at,
  };
}

const ALLOWLIST_INVALID = Errors.validation('allowlist', 'allowlist must be an array of strings or null', { example: '["@example.com"]' });

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

// While the page updates its data by email, the list is what keeps strangers out: it cannot be
// emptied, and a whole free-mail domain (anyone with a Gmail address) is refused, as at job creation.
// Same codes as PUT /v1/artifacts/{id}/email-sync/senders, so one mistake has one code on both.
const SENDERS_REQUIRED = (id: string) => ({ code: 'NO_SENDERS', status: 400, param: 'allowlist', message: 'This page updates its data by email, so keep at least one allowed sender (or remove the email sync first).', suggestion: `PUT /v1/artifacts/${id}/email-sync/senders with {"senders": ["person@company.com"]}` });
const FREE_MAIL_REFUSED = (entry: string) => ({ code: 'FREE_MAIL_DOMAIN', status: 400, param: 'allowlist', message: `"${entry}" would let anyone with such an address update this page by email. List the exact addresses instead.`, suggestion: `["ana@${entry.replace(/^@/, '')}"]` });
// The address is how the file gets in: switching it off would silently stop the page updating.
const SYNC_NEEDS_INBOX = { code: 'EMAIL_SYNC_ACTIVE', status: 409, message: 'This page updates its data by email, so its address has to stay on. Remove the email sync first (DELETE /v1/jobs/{jobId}) if it should stop.' };

const emailSyncJob = (ctx: DataContext) => ctx.env.DB.prepare(
  "SELECT id FROM scheduled_jobs WHERE artifact_id = ? AND action = 'email_sheet_sync' LIMIT 1"
).bind(ctx.artifactId).first<{ id: string }>();

async function emailSyncRefuses(ctx: DataContext, allowlist: string[] | null) {
  const entries = (allowlist || []).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const free = entries.find(isFreeMailDomain);
  if (entries.length && !free) return null;
  if (!(await emailSyncJob(ctx))) return null;
  return free ? FREE_MAIL_REFUSED(free) : SENDERS_REQUIRED(ctx.artifactId);
}

export async function handleInbox(
  request: Request,
  ctx: DataContext,
  subPath: string
): Promise<Response> {
  const path = subPath.replace(/\/$/, '') || '/';

  if (!(await verifyOwner(request, ctx))) return errorResponse(DATA_ERRORS.FORBIDDEN, ctx.origin);

  if (path === '/status' && request.method === 'GET') {
    return successResponse(await getInboxStatus(ctx.env, ctx.artifactId), 200, ctx.origin);
  }

  if (path === '/enable' && request.method === 'POST') {
    let allowlist: string[] | undefined;
    try {
      const body = await request.json() as { allowlist?: string[] };
      if (Array.isArray(body?.allowlist)) allowlist = body.allowlist;
      else if (body?.allowlist != null) return errorResponse(ALLOWLIST_INVALID, ctx.origin);
    } catch { /* no body is fine */ }
    const refused = allowlist !== undefined ? await emailSyncRefuses(ctx, allowlist) : null;
    if (refused) return errorResponse(refused, ctx.origin);
    await enableInbound(ctx.env, ctx.artifactId);
    if (allowlist !== undefined) await setInboundAllowlist(ctx.env, ctx.artifactId, allowlist);
    return successResponse(await getInboxStatus(ctx.env, ctx.artifactId), 200, ctx.origin);
  }

  if (path === '/disable' && request.method === 'POST') {
    const job = await emailSyncJob(ctx);
    if (job) return errorResponse({ ...SYNC_NEEDS_INBOX, message: SYNC_NEEDS_INBOX.message.replace('{jobId}', job.id) }, ctx.origin);
    await disableInbound(ctx.env, ctx.artifactId);
    return successResponse({ enabled: false }, 200, ctx.origin);
  }

  if (path === '/allowlist' && request.method === 'PUT') {
    let allowlist: string[] | null = null;
    try {
      const body = await request.json() as { allowlist?: string[] | null };
      allowlist = body?.allowlist ?? null;
    } catch {
      return errorResponse(DATA_ERRORS.INVALID_JSON, ctx.origin);
    }
    if (allowlist !== null && !isStringArray(allowlist)) return errorResponse(ALLOWLIST_INVALID, ctx.origin);
    const refused = await emailSyncRefuses(ctx, allowlist);
    if (refused) return errorResponse(refused, ctx.origin);
    await setInboundAllowlist(ctx.env, ctx.artifactId, allowlist);
    return successResponse(await getInboxStatus(ctx.env, ctx.artifactId), 200, ctx.origin);
  }

  if (path === '/messages' && request.method === 'GET') {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get('limit')) || undefined;
    const before = Number(url.searchParams.get('before')) || undefined;
    const rows = await listInboxMessages(ctx.env, ctx.artifactId, ctx.workspaceId, { limit, before });
    return successResponse({ messages: rows.map((r) => serializeMessage(r, false)) }, 200, ctx.origin);
  }

  // /messages/:id  and  /messages/:id/attachments/:index
  const msgMatch = path.match(/^\/messages\/([^/]+)$/);
  if (msgMatch && request.method === 'GET') {
    const row = await getInboxMessage(ctx.env, ctx.artifactId, ctx.workspaceId, msgMatch[1]);
    if (!row) return errorResponse(DATA_ERRORS.NOT_FOUND, ctx.origin);
    return successResponse(serializeMessage(row, true), 200, ctx.origin);
  }

  const attMatch = path.match(/^\/messages\/([^/]+)\/attachments\/(\d+)$/);
  if (attMatch && request.method === 'GET') {
    return serveAttachment(ctx, attMatch[1], Number(attMatch[2]));
  }

  return errorResponse(DATA_ERRORS.NOT_FOUND, ctx.origin);
}

async function serveAttachment(ctx: DataContext, messageId: string, index: number): Promise<Response> {
  const row = await getInboxMessage(ctx.env, ctx.artifactId, ctx.workspaceId, messageId);
  if (!row?.attachments_json) return errorResponse(DATA_ERRORS.NOT_FOUND, ctx.origin);

  let atts: StoredAttachment[] = [];
  try { atts = JSON.parse(row.attachments_json); } catch { /* ignore */ }
  const att = atts[index];
  if (!att) return errorResponse(DATA_ERRORS.NOT_FOUND, ctx.origin);

  const object = await ctx.env.ARTIFACTS.get(att.r2Key);
  if (!object) return errorResponse(DATA_ERRORS.NOT_FOUND, ctx.origin);

  return new Response(object.body, {
    headers: {
      'Content-Type': att.contentType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${att.filename.replace(/"/g, '')}"`,
    },
  });
}
