/**
 * The "<sharer> shared <page> with you" email: one sender for the share dialog
 * (POST /share), the Studio share panel (POST /collaborators with notify) and the
 * assistant's share action, so a person added by email always hears about it.
 */
import type { Env } from '../types';
import { checkEmailRateLimit, incrementEmailCount } from '../scheduling/email';
import { dispatchLifecycleEmail } from '../email/gateway';
import { workspaceArtifactUrl } from '../workspaces/domains/links';

export type ShareEmailRole = 'none' | 'viewer' | 'editor';

export interface ShareArtifactRow {
  id: string;
  name: string;
  description: string | null;
  slug: string;
  display_slug: string | null;
  auth_method: string;
  prod_slug: string | null;
  workspace_slug: string | null;
  workspace_id: string | null;
}

export interface ShareEmailOutcome {
  sent: string[];
  failed: { email: string; error: string }[];
}

export async function loadShareArtifact(env: Env, artifactId: string): Promise<ShareArtifactRow | null> {
  return env.DB.prepare(
    `SELECT a.id, a.name, a.description, a.slug, a.display_slug, a.auth_method, d.slug AS prod_slug, w.slug AS workspace_slug, a.workspace_id
     FROM artifacts a
     LEFT JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
     LEFT JOIN workspaces w ON w.id = a.workspace_id
     WHERE a.id = ?`
  ).bind(artifactId).first<ShareArtifactRow>();
}

/** The link people open: a workspace page's clean subdomain URL, else the apex /a/ route. */
export async function shareViewUrl(env: Env, artifact: ShareArtifactRow): Promise<string> {
  const slug = artifact.prod_slug || artifact.slug;
  return artifact.workspace_slug
    ? workspaceArtifactUrl(env, env.SHAREOUT_BASE_URL, artifact.workspace_slug, artifact.display_slug || slug)
    : `${env.SHAREOUT_BASE_URL}/a/${slug}/`;
}

/** Send the share email to each recipient, spending at most `remaining` of the daily budget. */
export async function deliverShareEmails(
  env: Env,
  opts: {
    artifact: ShareArtifactRow;
    senderId: string;
    recipients: string[];
    role: ShareEmailRole;
    message?: string;
    remaining: number;
  },
): Promise<ShareEmailOutcome & { remaining: number }> {
  const { artifact, senderId, recipients, role, message } = opts;
  const sender = await env.DB.prepare(
    'SELECT email, username, name FROM users WHERE id = ?'
  ).bind(senderId).first<{ email: string | null; username: string | null; name: string | null }>();

  const shareData = {
    artifactName: artifact.name,
    artifactDescription: artifact.description,
    viewUrl: await shareViewUrl(env, artifact),
    thumbnailUrl: `${env.SHAREOUT_BASE_URL}/t/${artifact.id}.webp`,
    sharerName: sender?.name?.trim() || sender?.username || sender?.email || undefined,
    customMessage: message,
    role,
  };

  const sent: string[] = [];
  const failed: { email: string; error: string }[] = [];
  let remaining = opts.remaining;

  for (const recipient of recipients) {
    if (remaining <= 0) {
      failed.push({ email: recipient, error: 'rate_limited' });
      continue;
    }
    const result = await dispatchLifecycleEmail(env, {
      type: 'artifact_share',
      toEmail: recipient,
      workspaceId: artifact.workspace_id ?? undefined,
      replyTo: sender?.email || undefined,
      data: { ...shareData, recipientEmail: recipient },
    });
    if (result.sent) {
      sent.push(recipient);
      await incrementEmailCount(env, senderId, artifact.id);
      remaining--;
    } else {
      failed.push({ email: recipient, error: result.error || result.skipped || 'send_failed' });
    }
  }

  return { sent, failed, remaining };
}

/**
 * Email people who were just given access. Access is already granted when this runs:
 * the daily email limit only skips the email, never the share. Never throws.
 */
export async function emailNewCollaborators(
  env: Env,
  senderId: string,
  artifactId: string,
  emails: string[],
  role: 'viewer' | 'editor',
): Promise<ShareEmailOutcome & { rate_limited: boolean; url: string | null }> {
  if (!emails.length) return { sent: [], failed: [], rate_limited: false, url: null };
  try {
    const artifact = await loadShareArtifact(env, artifactId);
    if (!artifact) return { sent: [], failed: emails.map((email) => ({ email, error: 'not_found' })), rate_limited: false, url: null };
    const url = await shareViewUrl(env, artifact);
    const rate = await checkEmailRateLimit(env, senderId, artifactId);
    if (!rate.allowed) {
      return { sent: [], failed: emails.map((email) => ({ email, error: 'rate_limited' })), rate_limited: true, url };
    }
    const out = await deliverShareEmails(env, { artifact, senderId, recipients: emails, role, remaining: rate.remaining });
    return { sent: out.sent, failed: out.failed, rate_limited: out.failed.some((f) => f.error === 'rate_limited'), url };
  } catch {
    return { sent: [], failed: emails.map((email) => ({ email, error: 'send_failed' })), rate_limited: false, url: null };
  }
}
