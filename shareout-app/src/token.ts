import type { Env } from './types';

export interface AccessTokenPayload {
  artifactId: string;
  authType: string;
  exp: number;
  email?: string;
}

export interface SessionPayload {
  userId: string;
  email: string;
  exp: number;
}

async function getHmacKey(secret: string, usage: 'sign' | 'verify'): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage]
  );
}

async function signPayload(payload: string, secret: string): Promise<string> {
  const key = await getHmacKey(secret, 'sign');
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

async function verifySignature(payload: string, signature: string, secret: string): Promise<boolean> {
  const key = await getHmacKey(secret, 'verify');
  const signatureBytes = Uint8Array.from(atob(signature), c => c.charCodeAt(0));
  return crypto.subtle.verify('HMAC', key, signatureBytes, new TextEncoder().encode(payload));
}

export async function createAccessToken(
  artifactId: string,
  authType: string,
  env: Env,
  maxAge = 60 * 60 * 24 * 30,
  email?: string
): Promise<string> {
  const payload: AccessTokenPayload = {
    artifactId,
    authType,
    exp: Math.floor(Date.now() / 1000) + maxAge,
    ...(email ? { email } : {}),
  };
  const data = btoa(JSON.stringify(payload));
  const sig = await signPayload(data, env.SESSION_SECRET);
  return `${data}.${sig}`;
}

export async function verifyAccessToken(
  token: string,
  artifactId: string,
  env: Env
): Promise<AccessTokenPayload | null> {
  try {
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;

    const valid = await verifySignature(payload, signature, env.SESSION_SECRET);
    if (!valid) return null;

    const data: AccessTokenPayload = JSON.parse(atob(payload));
    if (data.artifactId !== artifactId) return null;
    if (data.exp < Date.now() / 1000) return null;

    return data;
  } catch {
    return null;
  }
}

export async function createSessionToken(
  userId: string,
  email: string,
  env: Env,
  maxAge = 60 * 60 * 24 * 30
): Promise<string> {
  const payload: SessionPayload = {
    userId,
    email,
    exp: Math.floor(Date.now() / 1000) + maxAge,
  };
  const data = btoa(JSON.stringify(payload));
  const sig = await signPayload(data, env.SESSION_SECRET);
  return `${data}.${sig}`;
}

export async function verifySessionToken(
  token: string,
  env: Env
): Promise<SessionPayload | null> {
  try {
    const [payload, signature] = token.split('.');
    if (!payload || !signature) return null;

    const valid = await verifySignature(payload, signature, env.SESSION_SECRET);
    if (!valid) return null;

    const data: SessionPayload = JSON.parse(atob(payload));
    if (data.exp < Date.now() / 1000) return null;

    return data;
  } catch {
    return null;
  }
}

export function extractTokenFromCookie(cookie: string | null, pattern: RegExp): string | null {
  if (!cookie) return null;
  const match = cookie.match(pattern);
  return match ? match[1] : null;
}
