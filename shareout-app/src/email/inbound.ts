import PostalMime from 'postal-mime';
import type { Env, EmailReceivedPayload } from '../types';
import { inboxEmailDomain } from '../scheduling/email';
import { generateId, sha256 } from '../crypto-utils';
import { emitJobEvent } from '../scheduling/events';
import {
  resolveArtifactByPrefix,
  storeInboundMessage,
  incrementInboundCount,
  checkInboundRateLimit,
  senderAllowed,
  type StoredAttachment,
} from './inbox-store';
import { ingestSupportEmail } from '../support/email-ingest';
import { handleWorkspaceInbound } from './workspace-ingest';

// Max raw message size we accept (Cloudflare Email Routing caps near here anyway).
const MAX_RAW_BYTES = 25 * 1024 * 1024;
const TEXT_PREVIEW_BYTES = 2048;

// Reserved inbox local-part that opens/continues support tickets instead of routing
// to an artifact inbox. Mail to support@<inbox-domain> lands in the support workbench.
const SUPPORT_PREFIX = 'support';

/** Pull the bare address out of a "Name <addr@x>" From header. */
export function bareEmail(from: string): string {
  const m = from.match(/<([^>]+)>/);
  return (m ? m[1] : from).trim().toLowerCase();
}

interface AuthVerdicts {
  spf: string | null;
  dkim: string | null;
  dmarc: string | null;
}

/** Split `prefix+tag@inbox.shareout.site` into { prefix, tag }. Returns null when the
 *  address is not on the configured inbox domain — the apex-isolation guard. */
export function parseInboundAddress(
  to: string,
  inboxDomain: string
): { prefix: string; tag: string | null } | null {
  const at = to.lastIndexOf('@');
  if (at === -1) return null;
  const local = to.slice(0, at).toLowerCase().trim();
  const domain = to.slice(at + 1).toLowerCase().trim();
  if (domain !== inboxDomain.toLowerCase()) return null;
  if (!local) return null;

  const plus = local.indexOf('+');
  if (plus === -1) return { prefix: local, tag: null };
  return { prefix: local.slice(0, plus), tag: local.slice(plus + 1) || null };
}

export function parseAuthResults(headers: Headers): AuthVerdicts {
  const raw = headers.get('authentication-results') || '';
  const grab = (key: string): string | null => {
    const m = raw.match(new RegExp(`${key}=(\\w+)`, 'i'));
    return m ? m[1].toLowerCase() : null;
  };
  return { spf: grab('spf'), dkim: grab('dkim'), dmarc: grab('dmarc') };
}

/**
 * Cloudflare Email Routing entry point for inbound artifact mail. Resolves the
 * recipient to an opt-in inbox, parses + stores the message, and fires the
 * `email.received` event so the artifact's triggers run. Rejected mail is bounced
 * via setReject() so senders get a clear failure rather than a silent drop.
 */
export async function handleInboundEmail(
  message: ForwardableEmailMessage,
  env: Env,
  _ctx: ExecutionContext
): Promise<void> {
  const parsed = parseInboundAddress(message.to, inboxEmailDomain(env));
  if (!parsed) {
    message.setReject('Recipient not accepted');
    return;
  }

  if (parsed.prefix === SUPPORT_PREFIX) {
    await handleSupportInbound(message, env);
    return;
  }

  const res = await resolveArtifactByPrefix(env, parsed.prefix);
  if (!res) {
    const ws = await env.DB.prepare(
      'SELECT id, slug, name FROM workspaces WHERE slug = ? LIMIT 1'
    ).bind(parsed.prefix).first<{ id: string; slug: string; name: string }>();
    if (ws) {
      await handleWorkspaceInbound(message, env, ws);
      return;
    }
    message.setReject('Mailbox not found');
    return;
  }
  if (!res.inboundEnabled) {
    message.setReject('Mailbox not found');
    return;
  }

  if (message.rawSize > MAX_RAW_BYTES) {
    message.setReject('Message too large');
    return;
  }

  const auth = parseAuthResults(message.headers);
  const allowed = senderAllowed(message.from, res.allowlist);
  // Bounce spoofed senders unless explicitly allowlisted. A failing DMARC *and*
  // DKIM is the strong signal; allowlisted senders bypass (they opted in).
  if (!allowed) {
    message.setReject('Sender not permitted');
    return;
  }
  if (auth.dmarc === 'fail' && auth.dkim === 'fail' && !res.allowlist) {
    message.setReject('Failed authentication');
    return;
  }

  if (!(await checkInboundRateLimit(res))) {
    message.setReject('Inbox rate limit exceeded');
    return;
  }

  const rawBuffer = await new Response(message.raw).arrayBuffer();
  const email = await PostalMime.parse(rawBuffer);

  const rawMessageId = email.messageId || message.headers.get('message-id') || null;
  const rfcMessageId = rawMessageId ? rawMessageId.replace(/^<|>$/g, '') : null;
  // Dedupe key: prefer the RFC Message-ID; fall back to a content hash for
  // forwarders that strip it. Stored in the UNIQUE message_id column.
  const dedupeKey = rfcMessageId || `sha256:${await sha256(rawBuffer)}`;

  const id = generateId('inb');
  const text = email.text || '';
  const html = email.html || null;

  const attachments: StoredAttachment[] = [];
  for (const att of email.attachments || []) {
    const bytes =
      typeof att.content === 'string'
        ? new TextEncoder().encode(att.content)
        : new Uint8Array(att.content as ArrayBuffer);
    const filename = att.filename || `attachment-${attachments.length + 1}`;
    const r2Key = `inbox/${res.artifactId}/${id}/${attachments.length}-${filename}`;
    await env.ARTIFACTS.put(r2Key, bytes, {
      httpMetadata: { contentType: att.mimeType || 'application/octet-stream' },
    }).catch(() => {});
    attachments.push({ filename, contentType: att.mimeType || 'application/octet-stream', size: bytes.byteLength, r2Key });
  }

  const { isNew } = await storeInboundMessage(env, res.artifactId, res.workspaceId, {
    id,
    messageId: dedupeKey,
    from: message.from,
    to: message.to,
    tag: parsed.tag,
    subject: email.subject || null,
    textBody: text || null,
    htmlBody: html,
    spf: auth.spf,
    dkim: auth.dkim,
    dmarc: auth.dmarc,
    attachments,
    sizeBytes: message.rawSize,
    receivedAt: Math.floor(Date.now() / 1000),
  });

  // Duplicate delivery (Email Routing is at-least-once): don't double-fire triggers.
  if (!isNew) return;

  await incrementInboundCount(env, res.artifactId);

  const payload: EmailReceivedPayload = {
    messageId: id,
    rfcMessageId,
    from: message.from,
    to: message.to,
    prefix: parsed.prefix,
    tag: parsed.tag,
    subject: email.subject || null,
    textPreview: text.slice(0, TEXT_PREVIEW_BYTES),
    hasHtml: Boolean(html),
    attachments: attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, size: a.size })),
    auth,
    receivedAt: Math.floor(Date.now() / 1000),
  };

  await emitJobEvent(env, res.artifactId, 'email.received', payload);
}

/**
 * Inbound mail to support@<inbox-domain>. Reply-threads onto the sender's most recent
 * open ticket, otherwise opens a new one. Hard-spoofed mail (DMARC+DKIM both fail) is
 * bounced; everything else is accepted — this is a public support inbox.
 */
async function handleSupportInbound(message: ForwardableEmailMessage, env: Env): Promise<void> {
  if (message.rawSize > MAX_RAW_BYTES) {
    message.setReject('Message too large');
    return;
  }
  const auth = parseAuthResults(message.headers);
  if (auth.dmarc === 'fail' && auth.dkim === 'fail') {
    message.setReject('Failed authentication');
    return;
  }

  const rawBuffer = await new Response(message.raw).arrayBuffer();
  const email = await PostalMime.parse(rawBuffer);
  await ingestSupportEmail(env, {
    from: bareEmail(message.from),
    subject: email.subject,
    body: email.text,
  });
}
