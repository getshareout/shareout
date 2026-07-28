import type { Env } from '../types';
import { createMiniDb } from '../data/minidb-client';
import { generateEmailPrefix, inboxAddress } from '../scheduling/email';

// Server-side state for an artifact's opt-in inbound inbox. Config + quota live on
// the existing artifact_emails D1 row (alongside the outbound prefix); the messages
// themselves live in the per-artifact MiniDB (inbox_messages), keyed by artifact.

export interface StoredAttachment {
  filename: string;
  contentType: string;
  size: number;
  r2Key: string;
}

export interface InboundMessageInput {
  id: string;
  messageId: string | null;
  from: string;
  to: string;
  tag: string | null;
  subject: string | null;
  textBody: string | null;
  htmlBody: string | null;
  spf: string | null;
  dkim: string | null;
  dmarc: string | null;
  attachments: StoredAttachment[];
  sizeBytes: number;
  receivedAt: number;
}

export interface InboxMessageRow {
  id: string;
  message_id: string | null;
  from_addr: string;
  to_addr: string;
  tag: string | null;
  subject: string | null;
  text_body: string | null;
  html_body: string | null;
  spf: string | null;
  dkim: string | null;
  dmarc: string | null;
  attachments_json: string | null;
  size_bytes: number;
  received_at: number;
}

export interface InboxResolution {
  artifactId: string;
  workspaceId: string;
  inboundEnabled: boolean;
  allowlist: string[] | null;
  receivedToday: number;
  lastResetDate: string;
}

const INBOUND_DAILY_LIMIT = 200;

/** Resolve an inbound recipient prefix to its artifact + inbound config. Returns
 *  null when no artifact owns the prefix (so the handler can reject unknown mail). */
export async function resolveArtifactByPrefix(env: Env, prefix: string): Promise<InboxResolution | null> {
  const row = await env.DB.prepare(
    `SELECT ae.artifact_id, ae.inbound_enabled, ae.inbound_allowlist,
            ae.inbound_received_today, ae.inbound_last_reset_date, a.workspace_id
       FROM artifact_emails ae
       JOIN artifacts a ON a.id = ae.artifact_id
      WHERE ae.email_prefix = ?`
  ).bind(prefix).first<{
    artifact_id: string;
    inbound_enabled: number;
    inbound_allowlist: string | null;
    inbound_received_today: number;
    inbound_last_reset_date: string;
    workspace_id: string | null;
  }>();

  if (!row) return null;

  let allowlist: string[] | null = null;
  if (row.inbound_allowlist) {
    try {
      const parsed = JSON.parse(row.inbound_allowlist);
      if (Array.isArray(parsed) && parsed.length) allowlist = parsed.map((s) => String(s).toLowerCase());
    } catch { /* malformed allowlist => treat as none */ }
  }

  return {
    artifactId: row.artifact_id,
    workspaceId: row.workspace_id ?? '',
    inboundEnabled: row.inbound_enabled === 1,
    allowlist,
    receivedToday: row.inbound_received_today || 0,
    lastResetDate: row.inbound_last_reset_date,
  };
}

/** True when `sender` matches the allowlist (full address or @domain). */
export function senderAllowed(sender: string, allowlist: string[] | null): boolean {
  if (!allowlist) return true;
  const addr = sender.toLowerCase();
  const domain = addr.includes('@') ? addr.slice(addr.lastIndexOf('@') + 1) : '';
  return allowlist.some((entry) => entry === addr || entry === domain || entry === `@${domain}`);
}

/** Enable inbound for an artifact: ensure an artifact_emails row + prefix exist,
 *  then flip the inbound flag on. Idempotent; reuses an existing outbound prefix. */
export async function enableInbound(env: Env, artifactId: string): Promise<void> {
  const existing = await env.DB.prepare(
    'SELECT email_prefix FROM artifact_emails WHERE artifact_id = ?'
  ).bind(artifactId).first<{ email_prefix: string }>();

  if (!existing) {
    const artifact = await env.DB.prepare(
      `SELECT a.owner_id, COALESCE(d.slug, a.slug) AS slug
         FROM artifacts a
         LEFT JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
        WHERE a.id = ?`
    ).bind(artifactId).first<{ owner_id: string | null; slug: string | null }>();
    if (!artifact?.owner_id) return; // no artifact/owner => nothing to provision

    const prefix = await generateEmailPrefix(env, artifact.slug);
    await env.DB.prepare(
      `INSERT INTO artifact_emails (artifact_id, email_prefix, owner_id, inbound_enabled, inbound_enabled_at)
       VALUES (?, ?, ?, 1, ?)
       ON CONFLICT (artifact_id) DO UPDATE SET inbound_enabled = 1, inbound_enabled_at = excluded.inbound_enabled_at`
    ).bind(artifactId, prefix, artifact.owner_id, new Date().toISOString()).run();
    return;
  }

  await env.DB.prepare(
    `UPDATE artifact_emails SET inbound_enabled = 1, inbound_enabled_at = ? WHERE artifact_id = ?`
  ).bind(new Date().toISOString(), artifactId).run();
}

export async function disableInbound(env: Env, artifactId: string): Promise<void> {
  await env.DB.prepare(
    'UPDATE artifact_emails SET inbound_enabled = 0 WHERE artifact_id = ?'
  ).bind(artifactId).run();
}

export interface InboxStatus {
  enabled: boolean;
  address: string | null;
  allowlist: string[] | null;
  receivedToday: number;
}

export async function getInboxStatus(env: Env, artifactId: string): Promise<InboxStatus> {
  const row = await env.DB.prepare(
    `SELECT email_prefix, inbound_enabled, inbound_allowlist,
            inbound_received_today, inbound_last_reset_date
       FROM artifact_emails WHERE artifact_id = ?`
  ).bind(artifactId).first<{
    email_prefix: string;
    inbound_enabled: number;
    inbound_allowlist: string | null;
    inbound_received_today: number;
    inbound_last_reset_date: string;
  }>();

  if (!row) return { enabled: false, address: null, allowlist: null, receivedToday: 0 };

  const today = new Date().toISOString().split('T')[0];
  let allowlist: string[] | null = null;
  if (row.inbound_allowlist) {
    try {
      const parsed = JSON.parse(row.inbound_allowlist);
      if (Array.isArray(parsed) && parsed.length) allowlist = parsed.map((s) => String(s));
    } catch { /* ignore */ }
  }

  return {
    enabled: row.inbound_enabled === 1,
    address: row.inbound_enabled === 1 ? inboxAddress(row.email_prefix, env) : null,
    allowlist,
    receivedToday: row.inbound_last_reset_date === today ? (row.inbound_received_today || 0) : 0,
  };
}

export async function setInboundAllowlist(env: Env, artifactId: string, allowlist: string[] | null): Promise<void> {
  const value = allowlist && allowlist.length ? JSON.stringify(allowlist.map((s) => s.trim().toLowerCase()).filter(Boolean)) : null;
  await env.DB.prepare(
    'UPDATE artifact_emails SET inbound_allowlist = ? WHERE artifact_id = ?'
  ).bind(value, artifactId).run();
}

/** Per-artifact daily receive quota, mirroring the outbound emails_sent_today pattern. */
export async function checkInboundRateLimit(res: InboxResolution): Promise<boolean> {
  const today = new Date().toISOString().split('T')[0];
  const count = res.lastResetDate === today ? res.receivedToday : 0;
  return count < INBOUND_DAILY_LIMIT;
}

export async function incrementInboundCount(env: Env, artifactId: string): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  await env.DB.prepare(
    `UPDATE artifact_emails
        SET inbound_received_today = CASE WHEN inbound_last_reset_date = ? THEN inbound_received_today + 1 ELSE 1 END,
            inbound_last_reset_date = ?
      WHERE artifact_id = ?`
  ).bind(today, today, artifactId).run();
}

/** Insert a parsed message into the artifact's MiniDB inbox. Dedupes on message_id
 *  via INSERT OR IGNORE; returns isNew=false when a duplicate delivery was skipped. */
export async function storeInboundMessage(
  env: Env,
  artifactId: string,
  workspaceId: string,
  msg: InboundMessageInput
): Promise<{ isNew: boolean }> {
  const db = createMiniDb(env, artifactId, workspaceId);
  const result = await db.prepare(
    `INSERT OR IGNORE INTO inbox_messages
       (id, artifact_id, message_id, from_addr, to_addr, tag, subject, text_body, html_body,
        spf, dkim, dmarc, attachments_json, size_bytes, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    msg.id, artifactId, msg.messageId, msg.from, msg.to, msg.tag, msg.subject,
    msg.textBody, msg.htmlBody, msg.spf, msg.dkim, msg.dmarc,
    JSON.stringify(msg.attachments), msg.sizeBytes, msg.receivedAt
  ).run();
  return { isNew: (result.meta?.changes ?? 0) > 0 };
}

export async function listInboxMessages(
  env: Env,
  artifactId: string,
  workspaceId: string,
  opts: { limit?: number; before?: number } = {}
): Promise<InboxMessageRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 100);
  const db = createMiniDb(env, artifactId, workspaceId);
  const where = opts.before ? 'WHERE received_at < ?' : '';
  const binds: unknown[] = opts.before ? [opts.before, limit] : [limit];
  const { results } = await db.prepare(
    `SELECT id, message_id, from_addr, to_addr, tag, subject, text_body, html_body,
            spf, dkim, dmarc, attachments_json, size_bytes, received_at
       FROM inbox_messages ${where}
      ORDER BY received_at DESC LIMIT ?`
  ).bind(...binds).all<InboxMessageRow>();
  return results;
}

export async function getInboxMessage(
  env: Env,
  artifactId: string,
  workspaceId: string,
  id: string
): Promise<InboxMessageRow | null> {
  const db = createMiniDb(env, artifactId, workspaceId);
  return db.prepare(
    `SELECT id, message_id, from_addr, to_addr, tag, subject, text_body, html_body,
            spf, dkim, dmarc, attachments_json, size_bytes, received_at
       FROM inbox_messages WHERE id = ?`
  ).bind(id).first<InboxMessageRow>();
}

/** Delete all inbox messages + their R2 attachments for an artifact (cascade on
 *  artifact delete). Best-effort: R2 failures are swallowed so delete still proceeds. */
export async function purgeInbox(env: Env, artifactId: string, workspaceId: string): Promise<void> {
  const db = createMiniDb(env, artifactId, workspaceId);
  const { results } = await db.prepare(
    'SELECT attachments_json FROM inbox_messages'
  ).all<{ attachments_json: string | null }>();

  for (const row of results) {
    if (!row.attachments_json) continue;
    try {
      const atts = JSON.parse(row.attachments_json) as StoredAttachment[];
      for (const a of atts) await env.ARTIFACTS.delete(a.r2Key).catch(() => {});
    } catch { /* ignore malformed */ }
  }

  await db.prepare('DELETE FROM inbox_messages').run();
}
