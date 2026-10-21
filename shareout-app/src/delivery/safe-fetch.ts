import type { Env } from '../types';
import { isOwnHost } from '../config/origins';
import { BlockedRedirectError, fetchCheckingRedirects, isBlockedDestination } from '../data/secrets/blocklist';

export function destinationRefusal(env: Env, url: string): string | null {
  const u = new URL(url);
  u.hostname = u.hostname.replace(/\.+$/, '');
  const blocked = isBlockedDestination(u.toString());
  if (blocked.blocked) return blocked.reason ?? 'Blocked destination';
  return isOwnHost(env, u.hostname) ? 'Destination is this instance' : null;
}

export function safeFetch(env: Env, url: string, init: RequestInit): Promise<Response> {
  const refusal = destinationRefusal(env, url);
  if (refusal) throw new BlockedRedirectError(refusal);
  return fetchCheckingRedirects(url, init, (next) => destinationRefusal(env, next.toString()), {
    stripCredentialsCrossOrigin: true,
  });
}
