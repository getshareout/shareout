/** Formatting helpers for the home shell. */
import { parseSubdomain } from '../../subdomain';
import { getPlatformHostname, getPlatformOrigin } from '../../config/origins';
import type { Env } from '../../types';
import type { HomeFilters } from './types';

/** Public share URL: workspace subdomain shorthand when on *.<apex>, else /a/ on apex. */
export function buildArtifactShareUrl(
  hostname: string,
  deploySlug: string,
  displaySlug?: string | null,
  platformHost?: string,
  platformOrigin?: string,
  env?: Env,
): string {
  platformHost = platformHost || (env ? getPlatformHostname(env) : 'shareout.site');
  platformOrigin = platformOrigin || (env ? getPlatformOrigin(env) : 'https://shareout.site');
  const { isSubdomain, workspaceSlug } = parseSubdomain(hostname, platformHost);
  if (isSubdomain && workspaceSlug) {
    const pathSlug = displaySlug || deploySlug;
    const proto = platformOrigin.startsWith('http://') ? 'http' : 'https';
    return `${proto}://${workspaceSlug}.${platformHost}/${pathSlug}/`;
  }
  return `${platformOrigin.replace(/\/$/, '')}/a/${deploySlug}/`;
}

export function fmtCount(n: number): string {
  return n >= 1000000
    ? `${(n / 1000000).toFixed(1).replace(/\.0$/, '')}M`
    : n >= 1000
      ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
      : String(n);
}

export function buildResultLabel(filters: HomeFilters, total: number): string {
  const { search, type, scope } = filters;
  if (search) {
    return `${total} result${total === 1 ? '' : 's'} for “${search}”`;
  }
  if (type) return `${total} ${type}`;
  if (scope === 'shared') return `${total} shared with you`;
  if (scope === 'favorites') return `${total} favorite${total === 1 ? '' : 's'}`;
  return `${total} artifact${total === 1 ? '' : 's'}`;
}
