/**
 * Signed, short-lived path segment for the sandboxed template preview. The preview is
 * served with `Content-Security-Policy: sandbox`, so its document has an opaque origin
 * and its stylesheet/script/image requests carry no session cookie; the token in the
 * path is what lets those requests through. It names one template version and expires.
 * HMAC over SESSION_SECRET, the same scheme as the unsubscribe token.
 */
import type { Env } from '../types';

const TTL_SECONDS = 6 * 3600;

function b64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sign(env: Env, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.SESSION_SECRET || 'dev'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))));
}

export async function createViewToken(env: Env, templateId: string, versionNo: number, now = Date.now()): Promise<string> {
  const exp = Math.floor(now / 1000) + TTL_SECONDS;
  return `${exp}.${await sign(env, `tplview:${templateId}:${versionNo}:${exp}`)}`;
}

export async function verifyViewToken(env: Env, token: string, templateId: string, versionNo: number, now = Date.now()): Promise<boolean> {
  const [expRaw, sig] = token.split('.');
  const exp = Number(expRaw);
  if (!sig || !Number.isFinite(exp) || exp < Math.floor(now / 1000)) return false;
  const want = await sign(env, `tplview:${templateId}:${versionNo}:${exp}`);
  if (want.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}
