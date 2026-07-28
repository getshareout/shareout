/**
 * Per-artifact inbound email address provisioning.
 */
import type { Env } from '../../types';
import { getUserRole } from '../../artifacts';
import { artifactEmailAddress, generateEmailPrefix } from '../email';

/** Create or return the artifact's dedicated inbound email address. */
export async function createArtifactEmail(
  env: Env,
  userId: string,
  artifactId: string,
  replyTo?: string,
): Promise<{ email?: string; error?: string }> {
  const artifact = await env.DB.prepare(
    `SELECT a.id, a.name, d.slug AS slug FROM artifacts a
     JOIN deployments d ON d.artifact_id = a.id AND d.channel = 'production'
     WHERE a.id = ?`,
  ).bind(artifactId).first<{ id: string; name: string; slug: string }>();

  if (!artifact) {
    return { error: 'Artifact not found' };
  }

  const role = await getUserRole(env, artifactId, userId);
  if (!role || (role !== 'owner' && role !== 'editor')) {
    return { error: 'Permission denied: must be owner or editor' };
  }

  const existing = await env.DB.prepare(
    'SELECT email_prefix FROM artifact_emails WHERE artifact_id = ?',
  ).bind(artifactId).first<{ email_prefix: string }>();

  if (existing) {
    return { email: artifactEmailAddress(existing.email_prefix, env) };
  }

  const emailPrefix = await generateEmailPrefix(env, artifact.slug);

  await env.DB.prepare(`
    INSERT INTO artifact_emails (artifact_id, email_prefix, owner_id, reply_to)
    VALUES (?, ?, ?, ?)
  `).bind(artifactId, emailPrefix, userId, replyTo || null).run();

  return { email: artifactEmailAddress(emailPrefix, env) };
}

/** Resolve the artifact's inbound email address, if provisioned. */
export async function getArtifactEmail(env: Env, artifactId: string): Promise<string | null> {
  const result = await env.DB.prepare(
    'SELECT email_prefix FROM artifact_emails WHERE artifact_id = ?',
  ).bind(artifactId).first<{ email_prefix: string }>();

  return result ? artifactEmailAddress(result.email_prefix, env) : null;
}
