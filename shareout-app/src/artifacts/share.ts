/**
 * Share artifact via email (optional collaborator grant + notification).
 */
import type { Env, CollaboratorRole } from '../types';
import type { AuthUser } from '../api-auth';
import { checkEmailRateLimit, incrementEmailCount } from '../scheduling/email';
import { dispatchLifecycleEmail } from '../email/gateway';
import { addCollaboratorEmails } from './collaborators';
import { requireSharingRole } from './roles';
import { json } from './json-response';
import { buildSubdomainUrl } from '../subdomain';

type ShareRole = 'none' | 'viewer' | 'editor';

export async function handleShareArtifact(
  request: Request,
  env: Env,
  user: AuthUser,
  artifactId: string
): Promise<Response> {
  const artifact = await env.DB.prepare(
    `SELECT a.id, a.name, a.description, a.slug, a.display_slug, a.auth_method, d.slug AS prod_slug, w.slug AS workspace_slug
     FROM artifacts a
     LEFT JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
     LEFT JOIN workspaces w ON w.id = a.workspace_id
     WHERE a.id = ?`
  ).bind(artifactId).first<{
    id: string;
    name: string;
    description: string | null;
    slug: string;
    display_slug: string | null;
    auth_method: string;
    prod_slug: string | null;
    workspace_slug: string | null;
  }>();

  if (!artifact) {
    return json({ error: 'Artifact not found', code: 'NOT_FOUND' }, 404);
  }

  let body: { recipients?: unknown; message?: unknown; role?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON', code: 'INVALID_JSON' }, 400);
  }

  const role: ShareRole = body.role === 'editor' ? 'editor' : body.role === 'viewer' ? 'viewer' : 'none';

  const minRole: CollaboratorRole = role === 'none' ? 'viewer' : 'editor';
  const forbidden = await requireSharingRole(env, artifactId, user.id, minRole);
  if (forbidden) return forbidden;

  // A viewer may pass a page along, but the free-text note is an editor's to write:
  // it is 1 000 attacker-chosen characters delivered from the instance's own domain,
  // which is the difference between "here is a link" and a mailer.
  const mayWriteNote = !(await requireSharingRole(env, artifactId, user.id, 'editor'));

  const recipients = Array.isArray(body.recipients)
    ? Array.from(new Set(
        body.recipients
          .filter((e): e is string => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
          .map(e => e.toLowerCase().trim())
      )).slice(0, 10)
    : [];

  if (recipients.length === 0) {
    return json({ error: 'recipients must contain at least one valid email', code: 'INVALID_EMAILS' }, 400);
  }

  const message = mayWriteNote && typeof body.message === 'string'
    ? body.message.slice(0, 1000)
    : undefined;

  // Rate limit BEFORE granting: a 429 that has already added collaborators tells the
  // caller nothing happened while access is live.
  const rate = await checkEmailRateLimit(env, user.id, artifactId);
  const sent: string[] = [];
  const failed: { email: string; error: string }[] = [];

  if (!rate.allowed) {
    return json({
      success: false,
      sent,
      failed: recipients.map(email => ({ email, error: 'rate_limited' })),
      added: [],
      role,
      remaining: 0,
      error: 'Daily email limit reached',
      code: 'RATE_LIMITED',
      resetAt: rate.resetAt,
    }, 429);
  }

  let added: string[] = [];
  if (role !== 'none') {
    added = await addCollaboratorEmails(env, artifactId, recipients, role, user.id);
  }

  const sender = await env.DB.prepare(
    'SELECT email, username FROM users WHERE id = ?'
  ).bind(user.id).first<{ email: string | null; username: string | null }>();

  const slug = artifact.prod_slug || artifact.slug;
  // Workspace artifacts share their clean subdomain URL, not the apex /a/ routing key.
  const viewUrl = artifact.workspace_slug
    ? buildSubdomainUrl(env.SHAREOUT_BASE_URL, artifact.workspace_slug, artifact.display_slug || slug)
    : `${env.SHAREOUT_BASE_URL}/a/${slug}/`;
  const shareData = {
    artifactName: artifact.name,
    artifactDescription: artifact.description,
    viewUrl,
    thumbnailUrl: `${env.SHAREOUT_BASE_URL}/t/${artifactId}.webp`,
    sharerName: sender?.username || sender?.email || undefined,
    customMessage: message,
    role,
  };

  let remaining = rate.remaining;

  for (const recipient of recipients) {
    if (remaining <= 0) {
      failed.push({ email: recipient, error: 'rate_limited' });
      continue;
    }
    const result = await dispatchLifecycleEmail(env, {
      type: 'artifact_share',
      toEmail: recipient,
      replyTo: sender?.email || undefined,
      data: shareData,
    });
    if (result.sent) {
      sent.push(recipient);
      await incrementEmailCount(env, user.id, artifactId);
      remaining--;
    } else {
      failed.push({ email: recipient, error: result.error || 'send_failed' });
    }
  }

  return json({ success: sent.length > 0, sent, failed, added, role, remaining });
}
