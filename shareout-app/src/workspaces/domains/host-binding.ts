/**
 * A request that arrived on an active workspace custom domain carries this on its env
 * (`env.CUSTOM_HOST`), set once by the dispatcher. From then on the request behaves as
 * if it were on `<slug>.<apex>` (parseSubdomainFromEnv reads it), while absolute links
 * that point back at the page use the custom origin.
 */
import type { Env } from '../../types';
import { getPlatformOrigin } from '../../config/origins';

export interface CustomHostBinding {
  hostname: string;
  workspaceId: string;
  slug: string;
  /** https://<hostname> */
  origin: string;
}

export function bindCustomHost(env: Env, binding: Omit<CustomHostBinding, 'origin'>): Env {
  return { ...env, CUSTOM_HOST: { ...binding, origin: `https://${binding.hostname}` } };
}

/** The binding when `hostname` is the custom domain this request is being served on. */
export function customHostFor(env: Env, hostname: string): CustomHostBinding | null {
  const b = env.CUSTOM_HOST;
  return b && b.hostname === hostname.toLowerCase() ? b : null;
}

/**
 * Origin for absolute links back to this instance in a response: the custom domain
 * while serving on one, else SHAREOUT_BASE_URL (no trailing slash).
 */
export function servingOrigin(env: Env): string {
  if (env.CUSTOM_HOST) return env.CUSTOM_HOST.origin;
  return (env.SHAREOUT_BASE_URL || getPlatformOrigin(env)).replace(/\/$/, '');
}
