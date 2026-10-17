/**
 * Where a custom hostname is provisioned. Two implementations behind one interface:
 *
 *  - `cloudflare` — Cloudflare for SaaS custom hostnames on the platform zone. Cloudflare
 *    verifies ownership (TXT pre-validation) and issues the certificate (DCV).
 *    https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/getting-started/
 *    https://developers.cloudflare.com/api/resources/custom_hostnames/methods/create/
 *    https://developers.cloudflare.com/api/resources/custom_hostnames/methods/get/
 *    https://developers.cloudflare.com/api/resources/custom_hostnames/methods/edit/
 *    https://developers.cloudflare.com/api/resources/custom_hostnames/methods/delete/
 *    https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/domain-support/hostname-validation/pre-validation/
 *  - `manual` — no Cloudflare credentials (self-host, tests). The customer proves
 *    ownership with a TXT record we check over DNS-over-HTTPS; the operator routes the
 *    hostname to the Worker themselves (a Workers custom domain or route).
 */
import type { Env } from '../../types';

export type ProviderName = 'cloudflare' | 'manual';

/** What the provider says about one hostname right now. */
export interface ProviderState {
  providerId: string | null;
  /** true once ownership is verified AND (cloudflare) the certificate is active. */
  active: boolean;
  /** Cloudflare's hostname status, or 'pending'/'active' for manual. */
  status: string;
  sslStatus: string | null;
  /** The TXT record that proves ownership. */
  verification: { method: string; name: string; value: string } | null;
  errors: string[];
}

export interface CustomHostnameProvider {
  readonly name: ProviderName;
  create(hostname: string, token: string): Promise<ProviderState>;
  /** Re-read (and, for cloudflare, nudge DCV) the hostname's state. */
  refresh(hostname: string, providerId: string | null, token: string): Promise<ProviderState>;
  /** Remove it from the zone. Resolves when it is gone (a 404 counts as gone). */
  remove(providerId: string | null): Promise<void>;
}

export class ProviderError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

type FetchFn = typeof fetch;

const CF_API = 'https://api.cloudflare.com/client/v4';

interface CfCustomHostname {
  id: string;
  hostname: string;
  status?: string;
  ssl?: { status?: string; method?: string; type?: string; validation_errors?: Array<{ message?: string }> };
  ownership_verification?: { type?: string; name?: string; value?: string };
  verification_errors?: string[];
}

interface CfEnvelope<T> {
  success: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  result?: T;
}

function cfState(r: CfCustomHostname): ProviderState {
  const ov = r.ownership_verification;
  const errors = [
    ...(r.verification_errors || []),
    ...((r.ssl?.validation_errors || []).map((e) => e.message || '').filter(Boolean)),
  ];
  return {
    providerId: r.id,
    active: r.status === 'active' && r.ssl?.status === 'active',
    status: r.status || 'pending',
    sslStatus: r.ssl?.status || null,
    verification: ov?.name && ov.value ? { method: `cf_${ov.type || 'txt'}`, name: ov.name, value: ov.value } : null,
    errors,
  };
}

export function cloudflareProvider(token: string, zoneId: string, fetchFn: FetchFn = fetch): CustomHostnameProvider {
  const base = `${CF_API}/zones/${encodeURIComponent(zoneId)}/custom_hostnames`;
  async function call<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: CfEnvelope<T> }> {
    const res = await fetchFn(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({ success: false }))) as CfEnvelope<T>;
    return { status: res.status, data };
  }
  const fail = (what: string, status: number, data: CfEnvelope<unknown>) =>
    new ProviderError(`Cloudflare ${what} failed: ${(data.errors || []).map((e) => e.message).filter(Boolean).join('; ') || `HTTP ${status}`}`, status);
  // DV over HTTP: Cloudflare validates once the customer's CNAME points at us, and the
  // TXT ownership record lets them pre-validate before cutting traffic over.
  const ssl = { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } };
  return {
    name: 'cloudflare',
    async create(hostname) {
      const { status, data } = await call<CfCustomHostname>('POST', '', { hostname, ssl });
      if (!data.success || !data.result) throw fail('create', status, data);
      return cfState(data.result);
    },
    async refresh(_hostname, providerId) {
      if (!providerId) throw new ProviderError('No Cloudflare custom hostname id recorded', 409);
      const got = await call<CfCustomHostname>('GET', `/${encodeURIComponent(providerId)}`);
      if (!got.data.success || !got.data.result) throw fail('lookup', got.status, got.data);
      let r = got.data.result;
      // Sending the same ssl config back asks Cloudflare to retry validation now.
      if (!(r.status === 'active' && r.ssl?.status === 'active')) {
        const patched = await call<CfCustomHostname>('PATCH', `/${encodeURIComponent(providerId)}`, { ssl });
        if (patched.data.success && patched.data.result) r = patched.data.result;
      }
      return cfState(r);
    },
    async remove(providerId) {
      if (!providerId) return;
      const { status, data } = await call<unknown>('DELETE', `/${encodeURIComponent(providerId)}`);
      if (status === 404) return;
      if (!data.success) throw fail('delete', status, data);
    },
  };
}

const MANUAL_PREFIX = '_shareout-verify';

/** TXT record name the manual mode checks. */
export function manualVerificationName(hostname: string): string {
  return `${MANUAL_PREFIX}.${hostname}`;
}

/** TXT values for `name`, via Cloudflare's DNS-over-HTTPS JSON API. */
async function lookupTxt(name: string, fetchFn: FetchFn): Promise<string[]> {
  const res = await fetchFn(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`, {
    headers: { Accept: 'application/dns-json' },
  });
  if (!res.ok) throw new ProviderError(`DNS lookup failed: HTTP ${res.status}`, 502);
  const body = (await res.json().catch(() => ({}))) as { Answer?: Array<{ type?: number; data?: string }> };
  return (body.Answer || []).filter((a) => a.type === 16 && a.data).map((a) => a.data!.replace(/^"|"$/g, '').replace(/"\s*"/g, ''));
}

export function manualProvider(fetchFn: FetchFn = fetch): CustomHostnameProvider {
  return {
    name: 'manual',
    async create(hostname, token) {
      return {
        providerId: null, active: false, status: 'pending', sslStatus: null,
        verification: { method: 'dns_txt', name: manualVerificationName(hostname), value: token }, errors: [],
      };
    },
    async refresh(hostname, _providerId, token) {
      const name = manualVerificationName(hostname);
      const values = await lookupTxt(name, fetchFn);
      const ok = values.includes(token);
      return {
        providerId: null, active: ok, status: ok ? 'active' : 'pending', sslStatus: null,
        verification: { method: 'dns_txt', name, value: token },
        errors: ok ? [] : [values.length ? `TXT ${name} does not contain the verification token.` : `No TXT record found at ${name} yet.`],
      };
    },
    async remove() { /* nothing provisioned */ },
  };
}

let override: CustomHostnameProvider | null = null;

/** Tests: force a provider (the real Cloudflare API is never called from tests). */
export function setCustomHostnameProviderForTests(p: CustomHostnameProvider | null): void {
  override = p;
}

/** The provider for new hostnames (`name` omitted) or for a row created by `name`. */
export function providerFor(env: Env, name?: ProviderName): CustomHostnameProvider {
  if (override) return override;
  const configured = !!(env.CF_CUSTOM_HOSTNAMES_TOKEN && env.CF_CUSTOM_HOSTNAMES_ZONE_ID);
  if (name === 'cloudflare' || (!name && configured)) {
    if (!configured) throw new ProviderError('This hostname was provisioned on Cloudflare but CF_CUSTOM_HOSTNAMES_TOKEN / CF_CUSTOM_HOSTNAMES_ZONE_ID are not set.', 409);
    return cloudflareProvider(env.CF_CUSTOM_HOSTNAMES_TOKEN!, env.CF_CUSTOM_HOSTNAMES_ZONE_ID!);
  }
  return manualProvider();
}
