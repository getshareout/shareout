import PostalMime from 'postal-mime';
import type { Env } from '../types';
import { sha256 } from '../crypto-utils';
import { logAudit } from '../audit';
import { createLogger } from '../logging';
import { claimEmailSend, releaseEmailSend } from './email-log';
import { bareEmail, parseAuthResults } from './inbound';
import type { InvoiceReplyReason } from './catalog-invoice';
import { getBillingProfile } from '../workspaces/billing-profile';
import { REPLY_TOKEN_RE, fileProblem, invoiceFileKey, safeFileName, type InvoiceRecord } from '../workspaces/invoices';
import { notifyInvoicePaid, notifyInvoiceReply } from '../workspaces/invoice-mail';

const MAX_RAW_BYTES = 25 * 1024 * 1024;
const EXCERPT_CHARS = 1500;

// Phones and banks often send a PDF as application/octet-stream; the name says what it claims to be
// and fileProblem() still checks the bytes.
const BY_EXTENSION: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

interface MailFile {
  name: string;
  type: string;
  bytes: Uint8Array;
  inline: boolean;
}

function mailFiles(attachments: Awaited<ReturnType<typeof PostalMime.parse>>['attachments']): MailFile[] {
  return attachments.map((a, i) => {
    const name = safeFileName(a.filename, `attachment-${i + 1}`);
    let type = (a.mimeType || '').split(';')[0].trim().toLowerCase();
    if (!type || type === 'application/octet-stream') type = BY_EXTENSION[name.split('.').pop()!.toLowerCase()] ?? type;
    const bytes = typeof a.content === 'string' ? new TextEncoder().encode(a.content) : new Uint8Array(a.content);
    return { name, type, bytes, inline: a.disposition === 'inline' || !!a.related };
  });
}

// Names Outlook and Gmail give the images they embed in a body or signature (image001.png).
const EMBEDDED_IMAGE_NAME = /^image\d{3}\.(png|jpe?g|gif|webp)$/i;

/** The transfer proof among a reply's attachments: the first real attachment that passes the upload
 *  checks. Inline parts never count, and neither do images named like an embedded one: those are
 *  signature logos as often as screenshots, and a "thanks, received" with a logo must not mark an
 *  invoice paid. A pasted screenshot goes to the operator's review instead. */
function pickProof(files: MailFile[]): MailFile | null {
  return files.find((f) => !f.inline && !EMBEDDED_IMAGE_NAME.test(f.name) && !fileProblem(f.type, f.bytes)) ?? null;
}

/** Who may pay an invoice by email: the workspace's billing email, or one of its enabled internal owners/admins. */
async function allowedSender(env: Env, workspaceId: string, from: string): Promise<{ userId: string | null } | null> {
  const member = await env.DB.prepare(
    `SELECT u.id FROM workspace_members wm JOIN users u ON u.id = wm.user_id
      WHERE wm.workspace_id = ? AND lower(u.email) = ? AND wm.role IN ('owner', 'admin') AND wm.member_class = 'internal'
        AND COALESCE(u.disabled, 0) = 0 LIMIT 1`,
  ).bind(workspaceId, from).first<{ id: string }>();
  if (member) return { userId: member.id };
  const billing = (await getBillingProfile(env, workspaceId))?.billing_email?.toLowerCase().trim();
  return billing && billing === from ? { userId: null } : null;
}

/**
 * A reply to an invoice email: invoice+<reply token>@<inbox domain> (invoice-mail.ts sets it as the
 * Reply-To). An unknown token bounces like any unknown mailbox. The reply becomes the transfer proof
 * and marks the invoice paid (paid_source 'email') only when all of these hold: it passes the sender
 * check (DMARC on the header From, as for allowlisted artifact inboxes), it comes from the billing
 * email or an internal owner/admin, the invoice is unpaid, and it carries a PDF/PNG/JPG/WEBP of up
 * to 10 MB. Otherwise nothing on the invoice changes and the operator gets a notice to review it,
 * without the attachments. Machine replies (out of office) are dropped without a notice.
 */
export async function handleInvoiceInbound(message: ForwardableEmailMessage, env: Env, token: string | null): Promise<void> {
  const inv = token && REPLY_TOKEN_RE.test(token)
    ? await env.DB.prepare('SELECT * FROM workspace_invoices WHERE reply_token = ?').bind(token).first<InvoiceRecord>()
    : null;
  if (!inv) {
    message.setReject('Mailbox not found');
    return;
  }
  if (message.rawSize > MAX_RAW_BYTES) {
    message.setReject('Message too large');
    return;
  }
  const auth = parseAuthResults(message.headers);
  if (auth.dmarc === 'fail' && auth.dkim === 'fail') {
    message.setReject('Failed authentication');
    return;
  }
  const auto = (message.headers.get('auto-submitted') || '').trim().toLowerCase();
  if (auto && auto !== 'no') return;

  const raw = await new Response(message.raw).arrayBuffer();
  const email = await PostalMime.parse(raw);
  const messageId = (email.messageId || message.headers.get('message-id') || '').replace(/^<|>$/g, '');
  // Email Routing delivers at least once: handle each message once. A failure gives the claim back
  // and fails loudly, so a redelivery of the same message is processed instead of ignored.
  const claim = `${inv.id}:${messageId || `sha256:${await sha256(raw)}`}`;
  if (!(await claimEmailSend(env, 'invoice_reply', claim))) return;
  try {
    await applyReply(env, message, inv, email, auth.dmarc === 'pass');
  } catch (err) {
    createLogger(env, { scope: 'invoice-ingest' }).error('Invoice reply failed; a redelivery will retry it', { invoice_id: inv.id, error: String(err) });
    await releaseEmailSend(env, 'invoice_reply', claim);
    throw err;
  }
}

async function applyReply(
  env: Env, message: ForwardableEmailMessage, inv: InvoiceRecord, email: Awaited<ReturnType<typeof PostalMime.parse>>, verified: boolean,
): Promise<void> {
  // DMARC vouches for the header From, so that — not the envelope sender — is who replied.
  const from = (email.from?.address || bareEmail(message.from)).toLowerCase().trim();
  const files = mailFiles(email.attachments || []);
  const review = (reason: InvoiceReplyReason) => notifyInvoiceReply(env, inv, {
    from, reason, subject: email.subject?.trim() || null, excerpt: (email.text || '').trim().slice(0, EXCERPT_CHARS) || null,
    attachments: files.map((f) => f.name),
  }, verified);

  if (!verified) return review('unverified');
  const sender = await allowedSender(env, inv.workspace_id, from);
  if (!sender) return review('sender');
  if (inv.status !== 'open') return review(inv.status);
  const proof = pickProof(files);
  if (!proof) return review(files.length ? 'file' : 'no_attachment');

  // Store the proof before the invoice is marked paid, so a failed put leaves it unpaid (and throws).
  // The key is this reply's own: a reply that loses the race to another proof never overwrites it,
  // and its file is taken back down.
  const now = new Date().toISOString();
  const key = `${invoiceFileKey(inv.workspace_id, inv.id, 'proof')}-email-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  await env.ARTIFACTS.put(key, proof.bytes, { httpMetadata: { contentType: proof.type } });
  let paid: D1Result;
  try {
    paid = await env.DB.prepare(
      `UPDATE workspace_invoices SET proof_r2_key = ?, proof_name = ?, proof_type = ?, proof_uploaded_by = ?, proof_uploaded_at = ?,
          status = 'paid', paid_at = ?, paid_by = ?, paid_source = 'email', updated_at = ?
        WHERE id = ? AND status = 'open'`,
    ).bind(key, proof.name, proof.type, sender.userId, now, now, sender.userId, now, inv.id).run();
  } catch (err) {
    await env.ARTIFACTS.delete(key).catch(() => {});
    throw err;
  }
  if (!paid.meta?.changes) {
    await env.ARTIFACTS.delete(key).catch(() => {});
    return review('paid');
  }

  const entry = { workspaceId: inv.workspace_id, actorId: sender.userId, actorEmail: from, targetType: 'invoice', targetId: inv.id };
  await logAudit(env, { ...entry, action: 'invoice.proof', detail: { number: inv.number, name: proof.name, source: 'email' } });
  await logAudit(env, { ...entry, action: 'invoice.paid', detail: { number: inv.number, source: 'email' } });
  await notifyInvoicePaid(env, inv, 'email', from, { bytes: proof.bytes.slice().buffer, name: proof.name, type: proof.type });
}
