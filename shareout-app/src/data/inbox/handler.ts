import type { DataContext } from '../middleware';
import { errorResponse, successResponse, verifyOwner } from '../middleware';
import { DATA_ERRORS } from '../../types';
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

// Authenticated management surface for an artifact's inbound inbox. Read/list is
// allowed for any authorized viewer of the artifact (dataMiddleware already gated
// access); enable/disable/allowlist mutations require owner/editor (verifyOwner).

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

export async function handleInbox(
  request: Request,
  ctx: DataContext,
  subPath: string
): Promise<Response> {
  const path = subPath.replace(/\/$/, '') || '/';

  if (path === '/status' && request.method === 'GET') {
    return successResponse(await getInboxStatus(ctx.env, ctx.artifactId), 200, ctx.origin);
  }

  if (path === '/enable' && request.method === 'POST') {
    if (!(await verifyOwner(request, ctx))) return errorResponse(DATA_ERRORS.FORBIDDEN, ctx.origin);
    let allowlist: string[] | undefined;
    try {
      const body = await request.json() as { allowlist?: string[] };
      if (Array.isArray(body.allowlist)) allowlist = body.allowlist;
    } catch { /* no body is fine */ }
    await enableInbound(ctx.env, ctx.artifactId);
    if (allowlist !== undefined) await setInboundAllowlist(ctx.env, ctx.artifactId, allowlist);
    return successResponse(await getInboxStatus(ctx.env, ctx.artifactId), 200, ctx.origin);
  }

  if (path === '/disable' && request.method === 'POST') {
    if (!(await verifyOwner(request, ctx))) return errorResponse(DATA_ERRORS.FORBIDDEN, ctx.origin);
    await disableInbound(ctx.env, ctx.artifactId);
    return successResponse({ enabled: false }, 200, ctx.origin);
  }

  if (path === '/allowlist' && request.method === 'PUT') {
    if (!(await verifyOwner(request, ctx))) return errorResponse(DATA_ERRORS.FORBIDDEN, ctx.origin);
    let allowlist: string[] | null = null;
    try {
      const body = await request.json() as { allowlist?: string[] | null };
      allowlist = body.allowlist ?? null;
    } catch {
      return errorResponse(DATA_ERRORS.INVALID_JSON, ctx.origin);
    }
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
