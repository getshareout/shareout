import type { Env } from '../types';
import { newReplyToken, type InvoiceRecord } from './invoices';
import { getBillingProfile } from './billing-profile';
import { workspaceOrigin } from './domains/links';
import { suppressedSet } from '../email/suppressions';
import { buildEmail } from '../email/catalog-es';
import { renderEmailLayout, renderEmailText } from '../email/layout';
import type { InvoicePaidData, InvoiceReplyReviewData } from '../email/catalog-invoice';
import { INVOICE_INBOX_PREFIX, inboxAddress, sendEmail } from '../scheduling/email';
import { getPlatformHostname, getPlatformOrigin } from '../config/origins';
import { isLocale, localeForRecipient, type Locale } from '../i18n/locale';
import { platformAdminEmails } from '../superadmin/auth';
import { createLogger } from '../logging';

// Delivery of the invoices the operator issues (migrations/0041). Issuing emails the invoice to
// the workspace — its billing email, else its owners and admins — with the document attached and a
// per-invoice reply address, so a reply carrying the transfer proof marks it paid
// (email/invoice-ingest.ts). When a proof arrives either way, the operator (the platform admins)
// hears about it. Transactional mail: it does not read LIFECYCLE_EMAILS_DISABLED or the nurture
// flag, but it never mails an address on the suppression list, and every message lands in
// email_sends (source_kind 'invoice', source_id = the invoice).

export interface InvoiceRecipients {
  /** Who a send goes to now, suppressed addresses already dropped. */
  to: string[];
  /** The billing profile's email, or the owners and admins when it has none. */
  source: 'billing_email' | 'admins';
  /** Would have got it but are on the suppression list (bounced, complained or unsubscribed). */
  suppressed: string[];
}

export interface InvoiceSendResult {
  sent: boolean;
  to: string[];
  suppressed: string[];
  /** Why nothing went out. */
  code?: 'EMAIL_UNAVAILABLE' | 'NO_RECIPIENTS' | 'EMAIL_FAILED';
  error?: string;
}

/** A file to attach: the invoice document or a transfer proof. */
export interface InvoiceFile {
  bytes: ArrayBuffer;
  name: string;
  type: string;
}

const fromAddress = (env: Env) => env.EMAIL_DEFAULT_FROM || `noreply@${getPlatformHostname(env)}`;

export const invoiceReplyAddress = (env: Env, token: string) => inboxAddress(`${INVOICE_INBOX_PREFIX}+${token}`, env);

export async function invoiceRecipients(env: Env, workspaceId: string): Promise<InvoiceRecipients> {
  const billing = (await getBillingProfile(env, workspaceId))?.billing_email?.toLowerCase().trim();
  let candidates: string[] = billing ? [billing] : [];
  if (!billing) {
    const rows = (await env.DB.prepare(
      `SELECT lower(u.email) AS email FROM workspace_members wm JOIN users u ON u.id = wm.user_id
        WHERE wm.workspace_id = ? AND wm.role IN ('owner', 'admin') AND wm.member_class = 'internal'
          AND COALESCE(u.disabled, 0) = 0 AND COALESCE(u.is_service, 0) = 0 AND COALESCE(u.email, '') != ''
        ORDER BY wm.role DESC, lower(u.email)`,
    ).bind(workspaceId).all<{ email: string }>()).results ?? [];
    candidates = [...new Set(rows.map((r) => r.email.trim()))];
  }
  const suppressed = await suppressedSet(env, candidates).catch(() => new Set<string>());
  return {
    to: candidates.filter((e) => !suppressed.has(e)),
    source: billing ? 'billing_email' : 'admins',
    suppressed: candidates.filter((e) => suppressed.has(e)),
  };
}

async function workspaceFor(env: Env, workspaceId: string) {
  const ws = await env.DB.prepare('SELECT name, slug, locale FROM workspaces WHERE id = ?')
    .bind(workspaceId).first<{ name: string; slug: string; locale: string | null }>();
  if (!ws) return null;
  const billingUrl = `${await workspaceOrigin(env, getPlatformOrigin(env), ws.slug)}/home?view=admin&tab=billing`;
  return { name: ws.name, locale: (isLocale(ws.locale) ? ws.locale : 'en') as Locale, billingUrl };
}

/** The invoice's reply token, minted on its first send. Two sends racing agree on one token. */
async function replyToken(env: Env, inv: InvoiceRecord): Promise<string> {
  if (inv.reply_token) return inv.reply_token;
  await env.DB.prepare('UPDATE workspace_invoices SET reply_token = ? WHERE id = ? AND reply_token IS NULL')
    .bind(newReplyToken(), inv.id).run();
  const row = await env.DB.prepare('SELECT reply_token FROM workspace_invoices WHERE id = ?').bind(inv.id).first<{ reply_token: string }>();
  return row!.reply_token;
}

function attachment(file: InvoiceFile): EmailAttachment {
  // A copy per message, so one send can never hand the next a detached buffer.
  return { disposition: 'attachment', filename: file.name, type: file.type, content: file.bytes.slice(0) };
}

function render(type: Parameters<typeof buildEmail>[0], data: object, env: Env, locale: Locale) {
  const baseUrl = getPlatformOrigin(env);
  const built = buildEmail(type, data as Record<string, unknown>, { env, baseUrl, locale })!;
  return {
    subject: built.subject,
    html: renderEmailLayout({ baseUrl, preheader: built.preheader, heading: built.heading, bodyHtml: built.bodyHtml, cta: built.cta, footerNote: built.footerNote, locale }),
    text: renderEmailText({ heading: built.heading, bodyText: built.bodyText ?? '', cta: built.cta, footerNote: built.footerNote }),
  };
}

/** Email an issued invoice to the workspace with its document attached. Records emailed_at and
 *  emailed_to when it went out. Never throws: the result says what happened. */
export async function sendInvoiceEmail(env: Env, inv: InvoiceRecord): Promise<InvoiceSendResult> {
  try {
    const { to, suppressed, source } = await invoiceRecipients(env, inv.workspace_id);
    if (!env.EMAIL) return { sent: false, to, suppressed, code: 'EMAIL_UNAVAILABLE', error: 'Email is not set up on this instance (no EMAIL binding)' };
    if (!to.length) {
      const error = suppressed.length ? 'Every recipient is on the suppression list (bounced or unsubscribed)' : 'Nobody to send it to: no billing email and no owner or admin';
      return { sent: false, to, suppressed, code: 'NO_RECIPIENTS', error };
    }
    const ws = await workspaceFor(env, inv.workspace_id);
    if (!ws) return { sent: false, to, suppressed, code: 'NO_RECIPIENTS', error: 'Workspace not found' };

    const doc = inv.receipt_r2_key ? await env.ARTIFACTS.get(inv.receipt_r2_key) : null;
    const file = doc ? { bytes: await doc.arrayBuffer(), name: inv.receipt_name || 'invoice', type: inv.receipt_type || 'application/pdf' } : null;
    const mail = render('invoice_issued', {
      workspaceName: ws.name, number: inv.number, totalCents: inv.total_cents, currency: inv.currency, dueAt: inv.due_at,
      periodMonth: inv.period_month, notes: inv.notes, billingUrl: ws.billingUrl, hasDocument: !!file, audience: source,
    }, env, ws.locale);
    const res = await sendEmail(env, {
      from: fromAddress(env), to, ...mail, replyTo: invoiceReplyAddress(env, await replyToken(env, inv)),
      attachments: file ? [attachment(file)] : undefined,
      log: { sourceKind: 'invoice', sourceId: inv.id },
    });
    if (!res.success) return { sent: false, to, suppressed, code: 'EMAIL_FAILED', error: res.error };

    const now = new Date().toISOString();
    await env.DB.prepare('UPDATE workspace_invoices SET emailed_at = ?, emailed_to = ?, updated_at = ? WHERE id = ?')
      .bind(now, JSON.stringify(to), now, inv.id).run();
    return { sent: true, to, suppressed };
  } catch (e) {
    createLogger(env, { scope: 'invoice-mail' }).error('Invoice email failed', { invoice_id: inv.id, error: String(e) });
    return { sent: false, to: [], suppressed: [], code: 'EMAIL_FAILED', error: 'Could not send the invoice email' };
  }
}

async function operatorLocale(env: Env, email: string): Promise<Locale> {
  try {
    const user = await env.DB.prepare('SELECT id FROM users WHERE lower(email) = ?').bind(email).first<{ id: string }>();
    return user ? await localeForRecipient(env, { userId: user.id }) : 'en';
  } catch {
    return 'en';
  }
}

/** One message per platform admin, in their language. Best-effort: a notice never fails what triggered it. */
async function notifyOperators(
  env: Env, inv: InvoiceRecord, type: 'invoice_paid_notice' | 'invoice_reply_review',
  data: (ws: { name: string; billingUrl: string }) => object, opts: { file?: InvoiceFile; replyTo?: string } = {},
): Promise<void> {
  try {
    if (!env.EMAIL) return;
    const [admins, ws] = await Promise.all([platformAdminEmails(env), workspaceFor(env, inv.workspace_id)]);
    if (!ws) return;
    for (const to of admins) {
      const mail = render(type, data(ws), env, await operatorLocale(env, to));
      await sendEmail(env, {
        from: fromAddress(env), to: [to], ...mail, replyTo: opts.replyTo,
        attachments: opts.file ? [attachment(opts.file)] : undefined,
        log: { sourceKind: 'invoice', sourceId: inv.id },
      });
    }
  } catch (e) {
    createLogger(env, { scope: 'invoice-mail' }).warn('Operator invoice notice failed', { invoice_id: inv.id, type, error: String(e) });
  }
}

/** A transfer proof marked `inv` paid: tell the operator, proof attached. */
export function notifyInvoicePaid(env: Env, inv: InvoiceRecord, source: 'proof' | 'email', from: string, proof: InvoiceFile): Promise<void> {
  return notifyOperators(env, inv, 'invoice_paid_notice', (ws): InvoicePaidData => ({
    workspaceName: ws.name, number: inv.number, totalCents: inv.total_cents, currency: inv.currency, source, from, billingUrl: ws.billingUrl,
  }), { file: proof });
}

/** A reply to `inv`'s email changed nothing: tell the operator why. Its attachments are not forwarded;
 *  replying to the notice reaches the sender only when the sender passed the authentication check. */
export function notifyInvoiceReply(
  env: Env, inv: InvoiceRecord, reply: Pick<InvoiceReplyReviewData, 'from' | 'reason' | 'subject' | 'excerpt' | 'attachments'>, verified: boolean,
): Promise<void> {
  return notifyOperators(env, inv, 'invoice_reply_review', (ws): InvoiceReplyReviewData => ({
    ...reply, workspaceName: ws.name, number: inv.number, billingUrl: ws.billingUrl,
  }), { replyTo: verified ? reply.from : undefined });
}
