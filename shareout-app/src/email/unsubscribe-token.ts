import type { Env } from '../types';
import type { EmailCategory } from './preferences';
import { getPlatformOrigin } from '../config/origins';

// Signed one-click unsubscribe token (RFC 8058). Same HMAC-over-SESSION_SECRET
// scheme as src/token.ts. Encodes the user + category so the /email/unsubscribe
// route can opt them out without a session.
interface UnsubPayload {
  u: string; // userId
  c: EmailCategory;
}

async function hmac(payload: string, secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

function b64url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(s: string): string {
  return atob(s.replace(/-/g, '+').replace(/_/g, '/'));
}

export async function createUnsubscribeToken(env: Env, userId: string, category: EmailCategory): Promise<string> {
  const data = b64url(JSON.stringify({ u: userId, c: category } satisfies UnsubPayload));
  const key = await hmac(data, env.SESSION_SECRET, 'sign');
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const sigB64 = b64url(String.fromCharCode(...new Uint8Array(sig)));
  return `${data}.${sigB64}`;
}

export async function verifyUnsubscribeToken(
  env: Env,
  token: string,
): Promise<{ userId: string; category: EmailCategory } | null> {
  try {
    const [data, sig] = token.split('.');
    if (!data || !sig) return null;
    const key = await hmac(data, env.SESSION_SECRET, 'verify');
    const sigBytes = Uint8Array.from(unb64url(sig), (c) => c.charCodeAt(0));
    const ok = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(data));
    if (!ok) return null;
    const payload = JSON.parse(unb64url(data)) as UnsubPayload;
    return { userId: payload.u, category: payload.c };
  } catch {
    return null;
  }
}

/** Build the absolute one-click unsubscribe URL for an email. */
export async function unsubscribeUrl(env: Env, userId: string, category: EmailCategory): Promise<string> {
  const base = getPlatformOrigin(env);
  const token = await createUnsubscribeToken(env, userId, category);
  return `${base}/v1/email/unsubscribe?token=${encodeURIComponent(token)}`;
}
