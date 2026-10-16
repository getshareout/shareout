/**
 * Signed OAuth `state` for flows where ShareOut is the OAuth client. The state is
 * bound to a purpose and to the user who started the flow, and expires, so a
 * callback can't be replayed by another user or forged with someone else's code.
 */
import type { Env } from './types';
import { signPayload, verifySignature } from './token';

const STATE_TTL_SECONDS = 10 * 60;

interface StatePayload<T> {
  p: string;
  u: string;
  exp: number;
  d: T;
}

const stateKey = (env: Env) => `oauth-state:${env.SESSION_SECRET}`;

const encode = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
const decode = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));

export async function createOAuthState<T>(env: Env, purpose: string, userId: string, data: T): Promise<string> {
  const payload: StatePayload<T> = {
    p: purpose,
    u: userId,
    exp: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS,
    d: data,
  };
  const encoded = encode(JSON.stringify(payload));
  return `${encoded}.${await signPayload(encoded, stateKey(env))}`;
}

export async function verifyOAuthState<T>(
  env: Env,
  state: string,
  purpose: string,
  userId: string | null,
): Promise<T | null> {
  if (!userId) return null;
  try {
    const [encoded, sig] = state.split('.');
    if (!encoded || !sig) return null;
    if (!(await verifySignature(encoded, sig, stateKey(env)))) return null;
    const payload = JSON.parse(decode(encoded)) as StatePayload<T>;
    if (payload.p !== purpose || payload.u !== userId) return null;
    if (payload.exp < Date.now() / 1000) return null;
    return payload.d;
  } catch {
    return null;
  }
}

/** A post-OAuth return URL is only honored on the origin that started the flow. */
export function sameOriginReturnUrl(raw: string | null, origin: string): string {
  if (!raw) return '';
  try {
    const url = new URL(raw, origin);
    return url.origin === origin ? url.href : '';
  } catch {
    return '';
  }
}
