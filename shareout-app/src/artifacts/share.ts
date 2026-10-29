/**
 * Share artifact via email (optional collaborator grant + notification).
 */
import type { Env, CollaboratorRole } from '../types';
import type { AuthUser } from '../api-auth';
import { checkEmailRateLimit } from '../scheduling/email';
import { addCollaboratorEmails } from './collaborators';
import { requireSharingRole } from './roles';
import { json } from './json-response';
import { deliverShareEmails, loadShareArtifact, type ShareEmailRole } from './share-email';

type ShareRole = ShareEmailRole;

export async function handleShareArtifact(
  request: Request,
  env: Env,
  user: AuthUser,
  artifactId: string
): Promise<Response> {
  const artifact = await loadShareArtifact(env, artifactId);

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

  const { sent: delivered, failed: undelivered, remaining } = await deliverShareEmails(env, {
    artifact, senderId: user.id, recipients, role, message, remaining: rate.remaining,
  });
  sent.push(...delivered);
  failed.push(...undelivered);

  return json({ success: sent.length > 0, sent, failed, added, role, remaining });
}
