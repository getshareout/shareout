// Invoice mail (src/workspaces/invoice-mail.ts): the invoice the operator issued, to the workspace,
// and the two notices the operator gets back — a transfer proof marked it paid, or a reply to it
// changed nothing and needs a look. Transactional: invoice-mail.ts sends them itself (suppression
// list honoured, lifecycle and nurture flags ignored), so `audiences` is documentation here.
// English templates join EMAILS in catalog.ts; the Spanish (voseo) builders join EMAILS_ES in
// catalog-es.ts. Only type imports from the catalog, so neither file needs this one first.
import type { BuiltEmail, EmailContext, EmailTemplate } from './catalog';
import { escapeHtml } from './layout';
import { colors } from '../../packages/design-tokens/src/index';
import { localeTag, type Locale } from '../i18n/locale';

export interface InvoiceIssuedData {
  workspaceName: string;
  number: string;
  totalCents: number;
  currency: string;
  /** ISO, a UTC day. */
  dueAt: string | null;
  /** YYYY-MM. */
  periodMonth: string | null;
  /** How to pay: the operator's bank details. */
  notes: string | null;
  billingUrl: string;
  hasDocument: boolean;
  /** Who it went to: the billing email, or the owners and admins when there is none. */
  audience: 'billing_email' | 'admins';
}

export interface InvoicePaidData {
  workspaceName: string;
  number: string;
  totalCents: number;
  currency: string;
  source: 'proof' | 'email';
  /** Who attached or sent the proof. */
  from: string;
  billingUrl: string;
}

/** Why a reply to an invoice email changed nothing. */
export type InvoiceReplyReason = 'unverified' | 'sender' | 'paid' | 'void' | 'draft' | 'no_attachment' | 'file';

export interface InvoiceReplyReviewData {
  workspaceName: string;
  number: string;
  from: string;
  reason: InvoiceReplyReason;
  subject: string | null;
  excerpt: string | null;
  attachments: string[];
  billingUrl: string;
}

const p = (s: string) => `<p style="margin:0 0 14px">${s}</p>`;
const strong = (s: string) => `<strong>${escapeHtml(s)}</strong>`;
const quote = (s: string) =>
  `<blockquote style="margin:0 0 14px;padding:10px 14px;border-left:3px solid ${colors.border};color:${colors.text};white-space:pre-line">${escapeHtml(s)}</blockquote>`;
const facts = (rows: [string, string][]) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border-collapse:collapse">${rows.map(([k, v]) =>
    `<tr><td style="padding:3px 18px 3px 0;color:${colors.textTertiary}">${escapeHtml(k)}</td><td style="padding:3px 0;color:${colors.text};font-weight:600">${escapeHtml(v)}</td></tr>`).join('')}</table>`;
const factsText = (rows: [string, string][]) => rows.map(([k, v]) => `${k}: ${v}`).join('\n');

export function formatMoney(cents: number, currency: string, locale: Locale): string {
  try {
    return new Intl.NumberFormat(localeTag(locale), { style: 'currency', currency }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toFixed(2)}`;
  }
}

const day = (iso: string, locale: Locale) =>
  new Date(iso).toLocaleDateString(localeTag(locale), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const month = (ym: string, locale: Locale) =>
  new Date(`${ym}-01T00:00:00.000Z`).toLocaleDateString(localeTag(locale), { month: 'long', year: 'numeric', timeZone: 'UTC' });

function issuedFacts(d: InvoiceIssuedData, locale: Locale, labels: [string, string, string]): { total: string; due: string | null; rows: [string, string][] } {
  const total = formatMoney(d.totalCents, d.currency, locale);
  const due = d.dueAt ? day(d.dueAt, locale) : null;
  const rows: [string, string][] = [[labels[0], total]];
  if (due) rows.push([labels[1], due]);
  if (d.periodMonth) rows.push([labels[2], month(d.periodMonth, locale)]);
  return { total, due, rows };
}

const replyBody = (d: InvoiceReplyReviewData) => [d.subject, d.excerpt].filter(Boolean).join('\n\n');

const REPLY_WHY_EN: Record<InvoiceReplyReason, string> = {
  unverified: "the message didn't pass the sender check (SPF, DKIM, DMARC), so nothing proves it comes from that address",
  sender: "the sender isn't the workspace's billing email or one of its owners or admins",
  paid: 'the invoice is already paid',
  void: 'the invoice is void',
  draft: "the invoice hasn't been issued",
  no_attachment: 'it has no attachment',
  file: 'none of its attachments is a PDF, PNG, JPG or WEBP of up to 10 MB',
};

const REPLY_WHY_ES: Record<InvoiceReplyReason, string> = {
  unverified: 'el mensaje no pasó la verificación del remitente (SPF, DKIM, DMARC), así que nada garantiza que venga de esa dirección',
  sender: 'quien lo mandó no es el email de facturación del espacio ni uno de sus propietarios o administradores',
  paid: 'la factura ya está pagada',
  void: 'la factura está anulada',
  draft: 'la factura todavía no se emitió',
  no_attachment: 'no trae ningún adjunto',
  file: 'ninguno de los adjuntos es un PDF, PNG, JPG o WEBP de hasta 10 MB',
};

export const INVOICE_EMAILS = {
  invoice_issued: {
    category: 'transactional',
    audiences: ['ANY', 'EXTERNAL'],
    trigger: 'sendInvoiceEmail() — the operator issues an invoice (or resends it); goes to the billing email, else the owners and admins.',
    build: (d: InvoiceIssuedData) => {
      const { total, due, rows } = issuedFacts(d, 'en', ['Total', 'Due', 'Period']);
      const lead = `Here is invoice ${d.number} for ${d.workspaceName}.${d.hasDocument ? ' The invoice is attached.' : ''}`;
      const after = 'Once you have paid, reply to this email with the transfer receipt attached, or attach it in Admin → Billing. Either way, the invoice is marked paid.';
      return {
        subject: `Invoice ${d.number} for ${d.workspaceName}`,
        preheader: due ? `${total}, due ${due}.` : `${total}.`,
        heading: `Invoice ${d.number}`,
        bodyHtml:
          p(`Here is invoice ${strong(d.number)} for ${strong(d.workspaceName)}.${d.hasDocument ? ' The invoice is attached.' : ''}`) +
          facts(rows) +
          (d.notes ? p('<strong>How to pay</strong>') + quote(d.notes) : '') +
          p(escapeHtml(after)),
        cta: { label: 'Open Billing', href: d.billingUrl },
        footerNote: d.audience === 'billing_email'
          ? "You're getting this because this address is the workspace's billing email."
          : "You're getting this as an owner or admin of the workspace. To send invoices somewhere else, add a billing email in Admin → Billing.",
        bodyText: [lead, factsText(rows), d.notes ? `How to pay:\n${d.notes}` : '', after].filter(Boolean).join('\n\n'),
      };
    },
  } satisfies EmailTemplate<InvoiceIssuedData>,

  invoice_paid_notice: {
    category: 'transactional',
    audiences: ['ANY'],
    trigger: 'notifyInvoicePaid() — a workspace attached a transfer proof in Admin → Billing or replied to the invoice email with one, which marked it paid. To the platform admins, proof attached.',
    build: (d: InvoicePaidData) => {
      const total = formatMoney(d.totalCents, d.currency, 'en');
      const how = d.source === 'email' ? 'replied to the invoice email with' : 'attached';
      const check = 'Check that the money arrived. If it did not, open the invoice and mark it unpaid.';
      return {
        subject: `${d.workspaceName} paid invoice ${d.number}`,
        preheader: `${total}, transfer proof attached.`,
        heading: `Invoice ${d.number} is marked paid`,
        bodyHtml:
          p(`${strong(d.from)} ${how} a transfer proof for invoice ${strong(d.number)} (${escapeHtml(total)}) in ${strong(d.workspaceName)}, so it is marked paid. The proof is attached.`) +
          p(escapeHtml(check)),
        cta: { label: 'Open the invoice', href: d.billingUrl },
        footerNote: "You're getting this as an admin of this ShareOut instance.",
        bodyText: `${d.from} ${how} a transfer proof for invoice ${d.number} (${total}) in ${d.workspaceName}, so it is marked paid. The proof is attached.\n\n${check}`,
      };
    },
  } satisfies EmailTemplate<InvoicePaidData>,

  invoice_reply_review: {
    category: 'transactional',
    audiences: ['ANY'],
    trigger: 'handleInvoiceInbound() — a reply to an invoice email that changed nothing (unknown sender, failed sender check, no usable attachment, invoice not unpaid). To the platform admins, attachments not forwarded.',
    build: (d: InvoiceReplyReviewData) => {
      const lead = `${d.from} replied to invoice ${d.number} (${d.workspaceName}). Nothing changed on the invoice: ${REPLY_WHY_EN[d.reason]}.`;
      const next = "If it's a payment, check it and mark the invoice paid by hand. Attachments of replies like this one aren't forwarded.";
      const body = replyBody(d);
      return {
        subject: `A reply to invoice ${d.number} needs a look`,
        preheader: `From ${d.from}. Nothing was changed.`,
        heading: 'A reply to an invoice needs a look',
        bodyHtml:
          p(`${strong(d.from)} replied to invoice ${strong(d.number)} (${strong(d.workspaceName)}). Nothing changed on the invoice: ${escapeHtml(REPLY_WHY_EN[d.reason])}.`) +
          (body ? quote(body) : '') +
          (d.attachments.length ? p(`Attachments: ${escapeHtml(d.attachments.join(', '))}`) : '') +
          p(escapeHtml(next)),
        cta: { label: 'Open the invoice', href: d.billingUrl },
        footerNote: "You're getting this as an admin of this ShareOut instance.",
        bodyText: [lead, body, d.attachments.length ? `Attachments: ${d.attachments.join(', ')}` : '', next].filter(Boolean).join('\n\n'),
      };
    },
  } satisfies EmailTemplate<InvoiceReplyReviewData>,
} as const;

type Builder = (data: any, ctx: EmailContext) => BuiltEmail;

export const INVOICE_EMAILS_ES: Record<keyof typeof INVOICE_EMAILS, Builder> = {
  invoice_issued: (d: InvoiceIssuedData) => {
    const { total, due, rows } = issuedFacts(d, 'es', ['Total', 'Vencimiento', 'Período']);
    const lead = `Te mandamos la factura ${d.number} de ${d.workspaceName}.${d.hasDocument ? ' La tenés adjunta.' : ''}`;
    const after = 'Cuando la pagues, respondé este mail con el comprobante de transferencia adjunto o subilo en Admin → Facturación. Con cualquiera de los dos, la factura queda marcada como pagada.';
    return {
      subject: `Factura ${d.number} para ${d.workspaceName}`,
      preheader: due ? `${total}, vence el ${due}.` : `${total}.`,
      heading: `Factura ${d.number}`,
      bodyHtml:
        p(`Te mandamos la factura ${strong(d.number)} de ${strong(d.workspaceName)}.${d.hasDocument ? ' La tenés adjunta.' : ''}`) +
        facts(rows) +
        (d.notes ? p('<strong>Cómo pagar</strong>') + quote(d.notes) : '') +
        p(escapeHtml(after)),
      cta: { label: 'Abrir Facturación', href: d.billingUrl },
      footerNote: d.audience === 'billing_email'
        ? 'Te llega porque esta dirección es el email de facturación del espacio.'
        : 'Te llega porque sos propietario o administrador del espacio. Para mandar las facturas a otra dirección, cargá un email de facturación en Admin → Facturación.',
      bodyText: [lead, factsText(rows), d.notes ? `Cómo pagar:\n${d.notes}` : '', after].filter(Boolean).join('\n\n'),
    };
  },

  invoice_paid_notice: (d: InvoicePaidData) => {
    const total = formatMoney(d.totalCents, d.currency, 'es');
    const how = d.source === 'email' ? 'mandó por mail' : 'subió';
    const check = 'Revisá que la plata haya llegado. Si no llegó, abrí la factura y marcala sin pagar.';
    return {
      subject: `${d.workspaceName} pagó la factura ${d.number}`,
      preheader: `${total}, con el comprobante adjunto.`,
      heading: `La factura ${d.number} quedó pagada`,
      bodyHtml:
        p(`${strong(d.from)} ${how} el comprobante de transferencia de la factura ${strong(d.number)} (${escapeHtml(total)}) de ${strong(d.workspaceName)}, así que quedó marcada como pagada. Te lo adjuntamos.`) +
        p(escapeHtml(check)),
      cta: { label: 'Abrir la factura', href: d.billingUrl },
      footerNote: 'Te llega porque administrás esta instancia de ShareOut.',
      bodyText: `${d.from} ${how} el comprobante de transferencia de la factura ${d.number} (${total}) de ${d.workspaceName}, así que quedó marcada como pagada. Te lo adjuntamos.\n\n${check}`,
    };
  },

  invoice_reply_review: (d: InvoiceReplyReviewData) => {
    const lead = `${d.from} respondió la factura ${d.number} (${d.workspaceName}). No se cambió nada en la factura: ${REPLY_WHY_ES[d.reason]}.`;
    const next = 'Si es un pago, revisalo y marcá la factura como pagada a mano. Los adjuntos de respuestas como esta no se reenvían.';
    const body = replyBody(d);
    return {
      subject: `Una respuesta a la factura ${d.number} necesita que la mires`,
      preheader: `De ${d.from}. No se cambió nada.`,
      heading: 'Una respuesta a una factura necesita que la mires',
      bodyHtml:
        p(`${strong(d.from)} respondió la factura ${strong(d.number)} (${strong(d.workspaceName)}). No se cambió nada en la factura: ${escapeHtml(REPLY_WHY_ES[d.reason])}.`) +
        (body ? quote(body) : '') +
        (d.attachments.length ? p(`Adjuntos: ${escapeHtml(d.attachments.join(', '))}`) : '') +
        p(escapeHtml(next)),
      cta: { label: 'Abrir la factura', href: d.billingUrl },
      footerNote: 'Te llega porque administrás esta instancia de ShareOut.',
      bodyText: [lead, body, d.attachments.length ? `Adjuntos: ${d.attachments.join(', ')}` : '', next].filter(Boolean).join('\n\n'),
    };
  },
};
