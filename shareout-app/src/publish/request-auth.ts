/**
 * Auth and sharing helpers for publish requests — visibility coercion,
 * auth method selection, password hashing, and collaborator/credential sync.
 */
import type { Credential, PublishRequest, Visibility, Env } from '../types';
import { coerceVisibility } from '../visibility-config';
import { generateId } from '../crypto-utils';

export function resolveVisibility(body: PublishRequest, env: Env, allowOpen = false): Visibility {
  if (body.visibility) return coerceVisibility(env, body.visibility, allowOpen);
  if (body.private || body.password || body.credentials?.length || body.share_with?.length) {
    return 'private';
  }
  return coerceVisibility(env, 'public', allowOpen);
}

export function resolveAuthMethod(body: PublishRequest): 'google' | 'password' | 'credentials' {
  if (body.password) return 'password';
  if (body.credentials?.length) return 'credentials';
  return 'google';
}

export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function syncViewers(env: Env, artifactId: string, emails: string[]): Promise<void> {
  await env.DB.prepare(
    "DELETE FROM collaborators WHERE artifact_id = ? AND role = 'viewer'"
  ).bind(artifactId).run();

  for (const email of emails) {
    const collabId = generateId('col');
    await env.DB.prepare(
      'INSERT OR IGNORE INTO collaborators (id, artifact_id, email, role) VALUES (?, ?, ?, ?)'
    ).bind(collabId, artifactId, email.toLowerCase().trim(), 'viewer').run();
  }
}

export async function syncCredentials(env: Env, artifactId: string, credentials: Credential[]): Promise<void> {
  await env.DB.prepare('DELETE FROM artifact_passwords WHERE artifact_id = ?').bind(artifactId).run();

  for (const cred of credentials) {
    const credId = generateId('crd');
    const passwordHash = await hashPassword(cred.password);
    await env.DB.prepare(
      'INSERT OR IGNORE INTO artifact_passwords (id, artifact_id, username, password_hash) VALUES (?, ?, ?, ?)'
    ).bind(credId, artifactId, cred.user.toLowerCase().trim(), passwordHash).run();
  }
}
