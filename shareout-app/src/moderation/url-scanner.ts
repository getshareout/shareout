// Cloudflare URL Scanner adapter (Workstream B). Free with the Cloudflare account
// already running the Worker — no extra vendor. Reuses CF_ACCOUNT_ID + CF_API_TOKEN
// (the token needs URL Scanner permissions). No-ops gracefully when unset or on
// any error, so it is a best-effort augmentation, never a hard dependency.
//
// The scanner is asynchronous by design (submit -> later result). We therefore use
// it two ways: submitHostScan() seeds a scan fire-and-forget at publish, and
// checkHostsReputation() reads verdicts from PRIOR scans (used by the re-scan cron,
// Workstream D3). The synchronous publish gate relies on the AI classifier; the URL
// scanner catches known-bad hosts on the async path.

import type { Env } from '../types';
import { fetchWithTimeout } from '../fetch-utils';

const API = 'https://api.cloudflare.com/client/v4';
const TIMEOUT_MS = 4000;

function configured(env: Env): { accountId: string; token: string } | null {
  if (env.CF_ACCOUNT_ID && env.CF_API_TOKEN) {
    return { accountId: env.CF_ACCOUNT_ID, token: env.CF_API_TOKEN };
  }
  return null;
}

/** Fire-and-forget: ask Cloudflare to scan a URL so a verdict exists later. */
export async function submitHostScan(env: Env, url: string): Promise<void> {
  const cfg = configured(env);
  if (!cfg) return;
  try {
    await fetchWithTimeout(
      `${API}/accounts/${cfg.accountId}/urlscanner/v2/scan`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      },
      TIMEOUT_MS
    );
  } catch {
    // best-effort
  }
}

export type ReputationVerdict = 'clean' | 'malicious' | 'unknown';

interface SearchResponse {
  results?: Array<{ task?: { uuid: string }; verdicts?: { malicious?: boolean } }>;
}

/** Read the reputation of prior scans for these hosts. 'malicious' if any prior
 *  scan flagged one; 'unknown' when unconfigured / no prior scan / error. */
export async function checkHostsReputation(env: Env, hosts: string[]): Promise<ReputationVerdict> {
  const cfg = configured(env);
  if (!cfg || hosts.length === 0) return 'unknown';

  let sawAny = false;
  for (const host of hosts.slice(0, 10)) {
    try {
      // Search v2 matches by `page.domain` (NOT `hostname`, which 400s) and returns
      // each prior scan's verdict inline — no second result fetch needed.
      const searchRes = await fetchWithTimeout(
        `${API}/accounts/${cfg.accountId}/urlscanner/v2/search?q=${encodeURIComponent('page.domain:' + host)}&size=1`,
        { headers: { Authorization: `Bearer ${cfg.token}` } },
        TIMEOUT_MS
      );
      if (!searchRes.ok) continue;
      const search = (await searchRes.json()) as SearchResponse;
      const results = search.results ?? [];
      if (results.length === 0) continue;
      sawAny = true;
      if (results.some((r) => r.verdicts?.malicious === true)) return 'malicious';
    } catch {
      // best-effort per host
    }
  }
  return sawAny ? 'clean' : 'unknown';
}
