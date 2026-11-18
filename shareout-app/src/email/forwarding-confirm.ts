/**
 * Automatic forwarding to a page's address (Update by email).
 *
 * Gmail will not auto-forward to an address — from its settings or from a filter — until that
 * address confirms: it emails the address a confirmation link. A page's address bounced that mail
 * (Google is not on the page's list of senders), so the link never reached anyone. A genuine
 * confirmation is now recognised here, kept (only who asked, the link, the code when there is one,
 * when) and shown to the page's editors — the panel and check_email_sync — as one step: "Gmail
 * wants to confirm forwarding from ana@… → Confirm". Table: email_forward_confirmations (0047).
 *
 * What Google sends (two real copies from 2026-11, English and Spanish; older ones from 2012/2015):
 *   From: "Gmail Team" / "Equipo de Gmail" <forwarding-noreply@google.com>, To: the page's address;
 *   Subject: "(Gmail Forwarding Confirmation - Receive Mail from ana@gmail.com" /
 *            "Confirmación de reenvío de Gmail: recibir correo de ana@gmail.com" — older ones began
 *            "(#123456789) " and repeated it in the body as "Confirmation code: …"; today there is no code;
 *   Body: the confirm link https://mail-settings.google.com/mail/vf-%5B…%5D-… (older copies used
 *         mail.google.com and isolated.mail.google.com), and a cancel link …/mail/uf-… (never used).
 *   Signed DKIM d=google.com over from, to and subject; google.com publishes DMARC p=reject.
 *
 * Genuine = all of:
 *   - Cloudflare's own Authentication-Results (authserv-id mx.cloudflare.net) shows DMARC pass for
 *     google.com and a DKIM pass signed by google.com exactly;
 *   - exactly one From header, and it is Google's forwarding sender;
 *   - its (signed) To header is the address the mail was delivered to — a confirmation Google sent
 *     to someone else and passed on here unchanged is not one;
 *   - the shape: "Gmail" in the subject, and a confirm link that is https on one of Google's own
 *     hosts with the /mail/vf- path and nothing else (no credentials, port, query or fragment).
 * Anything else (a forged copy, a lookalike host, a link elsewhere) is not a confirmation, and the
 * mail goes on to the sender check like any other: bounced unless its sender is allowed.
 *
 * Microsoft Outlook / 365 has no such step: a forward or redirect rule starts at once (an admin
 * may block forwarding outside the company), so there is nothing to confirm for it.
 *
 * Also here: forwardingMailbox — which mailbox auto-forwarded a mail, when Cloudflare vouches for
 * it, so the panel can offer to allow a forwarded report's original sender with one tap.
 */
import type { Env } from '../types';
import { generateId } from '../crypto-utils';
import type { CloudflareAuth } from './inbound';
import { senderAllowed } from './inbox-store';

/** How long a confirmation stays on the panel. Google does not publish how long its link lasts
 *  (its signature on the mail expires after 7 days); a week covers "I set it up Friday, I look
 *  Monday", and a new request from the same mailbox replaces it anyway. */
export const FORWARD_CONFIRM_TTL_MS = 7 * 86_400_000;
/** Pending confirmations kept per page. Anyone who knows a page's address can make their own Gmail
 *  send it a genuine confirmation, so when there are more, requests from mailboxes NOT on the
 *  page's list go first (oldest first): strangers can neither grow the table nor push out the
 *  person's own. */
export const FORWARD_CONFIRMS_KEPT = 3;

export interface ForwardingConfirmation {
  provider: 'gmail';
  /** The mailbox asking to forward to the page, e.g. ana@gmail.com. */
  requester: string;
  /** Gmail's confirmation code — only older confirmations carry one. */
  code: string | null;
  /** The confirmation link: https, Google's own host only. */
  confirmUrl: string;
}

export interface PendingForwardConfirmation extends ForwardingConfirmation {
  id: string;
  receivedAt: string;
  expiresAt: string;
  openedAt: string | null;
}

interface ParsedMail {
  from?: { address?: string } | null;
  to?: { address?: string }[] | null;
  subject?: string;
  text?: string;
  html?: string;
  headers?: { key: string; value: string }[];
}

/** Google's forwarding-confirmation sender. */
export const GMAIL_FORWARDING_SENDER = 'forwarding-noreply@google.com';
/** The hosts Google's confirmation link has lived on. Exact match only. */
const GMAIL_CONFIRM_HOSTS = new Set(['mail-settings.google.com', 'mail.google.com', 'isolated.mail.google.com']);
const CONFIRM_PATH = /^\/mail\/vf-[A-Za-z0-9%._~-]+$/;
const ADDRESS_IN_TEXT = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/gi;
const MAX_URL = 2048;

/** The confirmation link, when `raw` is exactly the kind Google sends: https on its own host, the
 *  /mail/vf- path, nothing else. Anything else is null — never shown, never followed. */
export function gmailConfirmUrl(raw: string): string | null {
  if (raw.length > MAX_URL) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' || !GMAIL_CONFIRM_HOSTS.has(u.hostname) || u.port || u.username || u.password || u.search || u.hash) return null;
  return CONFIRM_PATH.test(u.pathname) ? u.href : null;
}

/** True when Cloudflare vouches that google.com sent it: DMARC pass for google.com and a DKIM pass
 *  signed by google.com itself (not a subdomain, not a lookalike). */
function googleSigned(auth: CloudflareAuth | null): boolean {
  if (!auth || auth.dmarc !== 'pass') return false;
  if (auth.dmarcFrom && auth.dmarcFrom !== 'google.com') return false;
  return auth.dkim.some((s) => s.result === 'pass' && s.domain === 'google.com');
}

/** A genuine Gmail forwarding confirmation delivered to `deliveredTo` (message.to), or null. */
export function gmailForwardingConfirmation(auth: CloudflareAuth | null, email: ParsedMail, deliveredTo: string): ForwardingConfirmation | null {
  const fromHeaders = (email.headers || []).filter((h) => h.key.toLowerCase() === 'from');
  if (fromHeaders.length !== 1) return null;
  if ((email.from?.address || '').trim().toLowerCase() !== GMAIL_FORWARDING_SENDER) return null;
  if (!googleSigned(auth)) return null;
  const dest = deliveredTo.trim().toLowerCase();
  if (!dest || !(email.to || []).some((a) => (a.address || '').trim().toLowerCase() === dest)) return null;

  const subject = (email.subject || '').replace(/\s+/g, ' ');
  if (!/\bgmail\b/i.test(subject.replace(ADDRESS_IN_TEXT, ' '))) return null;   // the word, not an @gmail.com address

  // The link: the first one in the text (or the HTML) that is Google's confirm link. Never any other.
  const text = email.text || '';
  const body = `${text}\n${email.html || ''}`;
  let confirmUrl: string | null = null;
  for (const m of body.matchAll(/https:\/\/[^\s"'<>()]+/g)) {
    confirmUrl = gmailConfirmUrl(m[0].replace(/&amp;/g, '&').replace(/[.,;]+$/, ''));
    if (confirmUrl) break;
  }
  if (!confirmUrl) return null;

  // Older confirmations carried a code ("(#123456789)" in the subject, "Confirmation code: …" in the body).
  const code = subject.match(/\(#(\d{6,12})\)/)?.[1] ?? text.match(/confirmation code:\s*(\d{6,12})/i)?.[1] ?? null;

  // Who asked: the address in the subject ("… from ana@gmail.com" / "… de ana@gmail.com"), else the
  // first one in the text — never Google's, never the page's own address. (Only that address: a
  // self-hosted instance may receive on its company's own mail domain, where ana@ is a real person.)
  const own = (a: string) => a === dest || a.endsWith('@google.com');
  const pick = (s: string) => [...s.matchAll(ADDRESS_IN_TEXT)].map((x) => x[0].toLowerCase().replace(/\.+$/, '')).find((a) => !own(a)) ?? null;
  const requester = pick(subject) ?? pick(text);
  if (!requester || requester.length > 320) return null;
  return { provider: 'gmail', requester, code, confirmUrl };
}

type Row = { id: string; provider: string; requester: string; code: string | null; confirm_url: string; expires_at: string; opened_at: string | null; created_at: string };

const toPending = (r: Row): PendingForwardConfirmation => ({
  id: r.id, provider: 'gmail', requester: r.requester, code: r.code, confirmUrl: r.confirm_url,
  receivedAt: r.created_at, expiresAt: r.expires_at, openedAt: r.opened_at,
});

/** Keep a confirmation for the page: one per asking mailbox (a new request replaces the old one),
 *  expired ones dropped, and at most FORWARD_CONFIRMS_KEPT — over that, requesters not on
 *  `allowlist` are dropped before any that are, oldest first. */
export async function saveForwardConfirmation(env: Env, artifactId: string, c: ForwardingConfirmation, allowlist: string[] | null): Promise<void> {
  const now = new Date();
  const link = gmailConfirmUrl(c.confirmUrl);
  if (!link) return;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM email_forward_confirmations WHERE artifact_id = ? AND (requester = ? OR expires_at <= ?)')
      .bind(artifactId, c.requester, now.toISOString()),
    env.DB.prepare(
      `INSERT INTO email_forward_confirmations (id, artifact_id, provider, requester, code, confirm_url, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(generateId('efc'), artifactId, c.provider, c.requester, c.code, link,
      new Date(now.getTime() + FORWARD_CONFIRM_TTL_MS).toISOString(), now.toISOString()),
  ]);
  const { results } = await env.DB.prepare(
    'SELECT id, requester FROM email_forward_confirmations WHERE artifact_id = ? ORDER BY created_at DESC, rowid DESC'
  ).bind(artifactId).all<{ id: string; requester: string }>();
  const rows = results || [];
  if (rows.length <= FORWARD_CONFIRMS_KEPT) return;
  const allowed = (r: { requester: string }) => !!allowlist && senderAllowed(r.requester, allowlist);
  const keep = new Set([...rows.filter(allowed), ...rows.filter((r) => !allowed(r))].slice(0, FORWARD_CONFIRMS_KEPT).map((r) => r.id));
  const drop = rows.filter((r) => !keep.has(r.id)).map((r) => r.id);
  await env.DB.prepare(`DELETE FROM email_forward_confirmations WHERE artifact_id = ? AND id IN (${drop.map(() => '?').join(',')})`)
    .bind(artifactId, ...drop).run();
}

/** The page's pending confirmations, newest first. */
export async function listForwardConfirmations(env: Env, artifactId: string): Promise<PendingForwardConfirmation[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, provider, requester, code, confirm_url, expires_at, opened_at, created_at
       FROM email_forward_confirmations WHERE artifact_id = ? AND expires_at > ?
      ORDER BY created_at DESC, rowid DESC LIMIT ${FORWARD_CONFIRMS_KEPT}`
  ).bind(artifactId, new Date().toISOString()).all<Row>();
  return (results || []).map(toPending);
}

/** An editor opened the link from the panel (`opened`) or closed the step (`dismiss`). false = no
 *  such confirmation on this page. */
export async function updateForwardConfirmation(env: Env, artifactId: string, id: string, action: 'opened' | 'dismiss'): Promise<boolean> {
  const res = action === 'opened'
    ? await env.DB.prepare('UPDATE email_forward_confirmations SET opened_at = ? WHERE id = ? AND artifact_id = ?')
      .bind(new Date().toISOString(), id, artifactId).run()
    : await env.DB.prepare('DELETE FROM email_forward_confirmations WHERE id = ? AND artifact_id = ?').bind(id, artifactId).run();
  return (res.meta?.changes ?? 0) > 0;
}

/** Forwarding from `mailbox` works (a mail it forwarded arrived): its confirmation is done. */
export async function clearForwardConfirmation(env: Env, artifactId: string, mailbox: string): Promise<void> {
  await env.DB.prepare('DELETE FROM email_forward_confirmations WHERE artifact_id = ? AND requester = ?')
    .bind(artifactId, mailbox.toLowerCase()).run();
}

/**
 * The mailbox that auto-forwarded this mail, when Cloudflare authenticated its envelope; null
 * otherwise. A forward keeps the original From but sends from the forwarder's own envelope, which
 * names the forwarding mailbox: Gmail `ana+caf_=…@gmail.com`, Microsoft 365 (Sender Rewriting
 * Scheme) `ana+SRS=…@acme.com`. Cloudflare's SPF pass for that envelope (its own
 * Authentication-Results, smtp.mailfrom) authenticates the domain; the provider controls the rest.
 *
 * Only ever used to say "forwarded from your mailbox", to offer a one-tap allow of the ORIGINAL
 * sender (an editor must press it) and to clear a finished confirmation — never to let a mail in.
 * Headers a sender writes (X-Forwarded-For, X-Forwarded-To, Sender, Resent-*) are not read at all.
 */
export function forwardingMailbox(auth: CloudflareAuth | null, envelopeFrom: string): string | null {
  if (!auth || auth.spf !== 'pass') return null;
  const envelope = envelopeFrom.trim().toLowerCase();
  const at = envelope.lastIndexOf('@');
  if (at < 1) return null;
  const local = envelope.slice(0, at), domain = envelope.slice(at + 1);
  // SPF authenticates the envelope's domain; Cloudflare names the envelope it checked (whole or domain only).
  if (!auth.spfMailFrom || (auth.spfMailFrom !== envelope && auth.spfMailFrom !== domain)) return null;
  const m = local.match(/^([^+=]+)\+(?:caf_=|srs=)/i);
  if (!m || !domain.includes('.')) return null;
  return `${m[1]}@${domain}`;
}
