/**
 * Custom-domain hostnames: one normal form (lowercase ASCII, IDNs as punycode, no
 * trailing dot, no port) and the rule for which hostnames a workspace may claim.
 */
import type { Env } from '../../types';
import { getCdnRegistrable, getPlatformHostname } from '../../config/origins';

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Lowercase ASCII (punycode) form of `input`, or null when it is not a hostname. */
export function normalizeHostname(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim().replace(/\.$/, '');
  if (!raw || raw.length > 253 || /[\s/?#@:\\]/.test(raw)) return null;
  let host: string;
  try {
    host = new URL(`https://${raw}`).hostname;
  } catch {
    return null;
  }
  host = host.toLowerCase().replace(/\.$/, '');
  if (!host || host.length > 253 || IPV4.test(host) || host.startsWith('[')) return null;
  const labels = host.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return null;
  if (/^\d+$/.test(labels[labels.length - 1]!)) return null;
  return host;
}

function within(host: string, zone: string | null | undefined): boolean {
  if (!zone) return false;
  const z = zone.toLowerCase().replace(/^www\./, '');
  return host === z || host.endsWith(`.${z}`);
}

/** The hostname customers CNAME to: CUSTOM_DOMAINS_CNAME_TARGET, else the apex itself. */
export function cnameTarget(env: Env): string {
  return normalizeHostname(env.CUSTOM_DOMAINS_CNAME_TARGET) || getPlatformHostname(env);
}

/** Whether this instance serves workspace custom domains at all. */
export function customDomainsEnabled(env: Env): boolean {
  return !!(env.CUSTOM_DOMAINS_CNAME_TARGET || (env.CF_CUSTOM_HOSTNAMES_TOKEN && env.CF_CUSTOM_HOSTNAMES_ZONE_ID));
}

/**
 * Why `host` (already normalized) cannot be a workspace custom domain, or null when it
 * can. Hostnames the instance serves itself — the apex and its subdomains, the content
 * domain, the docs host, the CNAME target — are never claimable.
 */
export function unclaimableReason(env: Env, host: string): string | null {
  if (within(host, getPlatformHostname(env))) return 'This hostname belongs to the instance itself.';
  if (within(host, getCdnRegistrable(env))) return 'This hostname belongs to the instance content domain.';
  if (env.DOCS_HOST && within(host, normalizeHostname(env.DOCS_HOST))) return 'This hostname is the docs host.';
  if (within(host, cnameTarget(env))) return 'This hostname is the custom-domain CNAME target.';
  if (host.endsWith('.workers.dev') || host.endsWith('.pages.dev') || host === 'localhost' || host.endsWith('.localhost')) {
    return 'Use a hostname on a domain you own.';
  }
  return null;
}

/** True when a request on `host` might be for a custom domain (not one the instance owns). */
export function isForeignHost(env: Env, host: string): boolean {
  const h = host.toLowerCase();
  if (!h.includes('.') || h === 'localhost' || h.endsWith('.localhost') || IPV4.test(h) || h.startsWith('[')) return false;
  if (h.endsWith('.workers.dev') || h.endsWith('.pages.dev')) return false;
  if (within(h, getPlatformHostname(env)) || within(h, getCdnRegistrable(env))) return false;
  if (env.DOCS_HOST && h === env.DOCS_HOST.toLowerCase()) return false;
  return true;
}
