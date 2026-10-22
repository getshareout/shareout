import type { Env } from '../types';
import { getPlatformOrigin } from '../config/origins';
import { JSON_IN, jsonList } from '../sql-in';

// Per-artifact email opt-out. The link token is HMAC-signed over (artifact, email) and carries a
// purpose prefix, so it cannot be replayed as a user-preference token (unsubscribe-token.ts) or
// for another artifact/address. It is the only credential; there is no lookup by email alone.

const PURPOSE = 'artifact-email-optout|';

const norm = (e: string) => (e || '').toLowerCase().trim();
const b64url = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));

function utf8b64(s: string): string {
  return b64url(String.fromCharCode(...new TextEncoder().encode(s)));
}
function unutf8b64(s: string): string {
  return new TextDecoder().decode(Uint8Array.from(unb64url(s), (c) => c.charCodeAt(0)));
}

async function key(env: Env, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

export async function createArtifactOptoutToken(env: Env, artifactId: string, email: string): Promise<string> {
  const data = utf8b64(JSON.stringify({ a: artifactId, e: norm(email) }));
  const sig = await crypto.subtle.sign('HMAC', await key(env, 'sign'), new TextEncoder().encode(PURPOSE + data));
  return `${data}.${b64url(String.fromCharCode(...new Uint8Array(sig)))}`;
}

export async function verifyArtifactOptoutToken(env: Env, token: string): Promise<{ artifactId: string; email: string } | null> {
  try {
    const [data, sig] = token.split('.');
    if (!data || !sig) return null;
    const sigBytes = Uint8Array.from(unb64url(sig), (c) => c.charCodeAt(0));
    const ok = await crypto.subtle.verify('HMAC', await key(env, 'verify'), sigBytes, new TextEncoder().encode(PURPOSE + data));
    if (!ok) return null;
    const p = JSON.parse(unutf8b64(data)) as { a?: unknown; e?: unknown };
    return typeof p.a === 'string' && typeof p.e === 'string' && p.a && p.e ? { artifactId: p.a, email: p.e } : null;
  } catch {
    return null;
  }
}

export async function artifactOptoutUrl(env: Env, artifactId: string, email: string): Promise<string> {
  const token = await createArtifactOptoutToken(env, artifactId, email);
  return `${getPlatformOrigin(env)}/v1/email/artifact-unsubscribe?token=${encodeURIComponent(token)}`;
}

/** Addresses among `emails` that opted out of this artifact's emails (lowercased). */
export async function optedOutSet(env: Env, artifactId: string, emails: string[]): Promise<Set<string>> {
  const normed = emails.map(norm).filter(Boolean);
  if (!normed.length) return new Set();
  const rows = await env.DB.prepare(
    `SELECT email FROM artifact_email_optouts WHERE artifact_id = ? AND email IN ${JSON_IN}`,
  ).bind(artifactId, jsonList(normed)).all<{ email: string }>();
  return new Set((rows.results || []).map((r) => r.email));
}

export async function addArtifactOptout(env: Env, artifactId: string, email: string): Promise<void> {
  await env.DB.prepare('INSERT OR IGNORE INTO artifact_email_optouts (artifact_id, email) VALUES (?, ?)')
    .bind(artifactId, norm(email)).run();
}

export async function removeArtifactOptout(env: Env, artifactId: string, email: string): Promise<void> {
  await env.DB.prepare('DELETE FROM artifact_email_optouts WHERE artifact_id = ? AND email = ?')
    .bind(artifactId, norm(email)).run();
}

export async function listArtifactOptouts(env: Env, artifactId: string): Promise<Array<{ email: string; created_at: string }>> {
  const rows = await env.DB.prepare('SELECT email, created_at FROM artifact_email_optouts WHERE artifact_id = ? ORDER BY created_at DESC LIMIT 500')
    .bind(artifactId).all<{ email: string; created_at: string }>();
  return rows.results || [];
}
