import type { Env } from '../../types';

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Meta signs every webhook body with the app secret: `X-Hub-Signature-256: sha256=<hex hmac>`.
 * No secret configured = nothing is trusted.
 */
export async function verifyWhatsAppSignature(env: Env, rawBody: string, header: string | null): Promise<boolean> {
  if (!env.WHATSAPP_APP_SECRET || !header?.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.WHATSAPP_APP_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)));
  return timingSafeEqual(mac, header.slice('sha256='.length).toLowerCase());
}

/** The one-time GET Meta sends when the webhook is set up: echo the challenge if the verify token matches. */
export function whatsAppSubscribeChallenge(env: Env, url: URL): string | null {
  if (!env.WHATSAPP_VERIFY_TOKEN) return null;
  if (url.searchParams.get('hub.mode') !== 'subscribe') return null;
  const token = url.searchParams.get('hub.verify_token') ?? '';
  if (!timingSafeEqual(token, env.WHATSAPP_VERIFY_TOKEN)) return null;
  return url.searchParams.get('hub.challenge');
}
