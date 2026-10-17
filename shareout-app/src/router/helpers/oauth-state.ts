// Signed `state` for connector OAuth installs. The callback only acts on a state this
// instance issued, for the same signed-in user, before it expires.
import type { Env } from '../../types';
import { signPayload, verifySignature } from '../../token';

const STATE_TTL_SEC = 60 * 30;
const DOMAIN = 'connector-oauth-state';

function b64urlEncode(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}

export async function signOAuthState<T extends Record<string, unknown>>(env: Env, userId: string, fields: T, now = Date.now()): Promise<string> {
  const data = b64urlEncode(JSON.stringify({ ...fields, uid: userId, exp: Math.floor(now / 1000) + STATE_TTL_SEC }));
  const sig = await signPayload(`${DOMAIN}.${data}`, env.SESSION_SECRET);
  return `${data}.${b64urlEncode(atob(sig))}`;
}

/** The state's fields when it is authentic, unexpired and issued to `userId`; else null. */
export async function readOAuthState<T extends Record<string, unknown>>(
  env: Env, raw: string | null, userId: string | null, now = Date.now(),
): Promise<T | null> {
  if (!raw || !userId || !env.SESSION_SECRET) return null;
  const [data, sig] = raw.split('.');
  if (!data || !sig) return null;
  try {
    if (!(await verifySignature(`${DOMAIN}.${data}`, btoa(b64urlDecode(sig)), env.SESSION_SECRET))) return null;
    const parsed = JSON.parse(b64urlDecode(data)) as T & { uid?: unknown; exp?: unknown };
    if (parsed.uid !== userId || typeof parsed.exp !== 'number' || parsed.exp < now / 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}
