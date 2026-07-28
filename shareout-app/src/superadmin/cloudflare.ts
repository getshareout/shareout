import type { Env } from '../types';
import { CF_PRICING } from './cf-pricing';

export interface CloudflareUsage {
  available: boolean;
  reason?: string;
  periodDays: number;
  workersRequests: number;
  d1RowsRead: number;
  d1RowsWritten: number;
  r2ClassA: number;
  r2ClassB: number;
  kvReads: number;
  kvWrites: number;
  lines: Array<{ label: string; detail: string; costUsd: number }>;
  totalUsd: number;
}

const GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';

// Pull billable usage from the Cloudflare GraphQL Analytics API and price it with
// CF_PRICING. Fully defensive: any missing config, network error, or GraphQL
// error returns { available: false } so the portal still renders the costs we can
// measure internally (storage, LLM). Pro-rates monthly allowances to the window.
export async function fetchCloudflareUsage(
  env: Env,
  days: number,
  opts: { since?: string; until?: string } = {}
): Promise<CloudflareUsage> {
  const base: CloudflareUsage = {
    available: false,
    periodDays: days,
    workersRequests: 0,
    d1RowsRead: 0,
    d1RowsWritten: 0,
    r2ClassA: 0,
    r2ClassB: 0,
    kvReads: 0,
    kvWrites: 0,
    lines: [],
    totalUsd: 0,
  };

  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) {
    return { ...base, reason: 'Set CF_ACCOUNT_ID and CF_API_TOKEN to enable infra cost tracking.' };
  }

  // Cloudflare usage has daily granularity, so cache it (10 min) to keep the
  // admin portal snappy instead of round-tripping the GraphQL API on every view.
  const cacheKey =
    opts.since || opts.until
      ? `cf-usage:v1:range:${opts.since ?? ''}:${opts.until ?? ''}`
      : `cf-usage:v1:${days}`;
  if (env.PROXY_CACHE) {
    const cached = await env.PROXY_CACHE.get(cacheKey, 'json').catch(() => null);
    if (cached) return cached as CloudflareUsage;
  }

  // Explicit since/until bound an exact calendar range; otherwise a rolling N-day window.
  const sinceDate = opts.since ?? new Date(Date.now() - days * 86400_000).toISOString().split('T')[0];
  const untilDate = opts.until ?? null;
  const dateFilter = untilDate ? 'date_geq: $since, date_leq: $until' : 'date_geq: $since';
  const query = `
    query Usage($tag: String!, $since: Date!, $until: Date) {
      viewer {
        accounts(filter: { accountTag: $tag }) {
          workersInvocationsAdaptive(limit: 10000, filter: { ${dateFilter} }) {
            sum { requests }
          }
          d1AnalyticsAdaptiveGroups(limit: 10000, filter: { ${dateFilter} }) {
            sum { rowsRead rowsWritten }
          }
          r2OperationsAdaptiveGroups(limit: 10000, filter: { ${dateFilter} }) {
            sum { requests }
            dimensions { actionType }
          }
          kvOperationsAdaptiveGroups(limit: 10000, filter: { ${dateFilter} }) {
            sum { requests }
            dimensions { actionType }
          }
        }
      }
    }`;

  let account: any;
  try {
    const res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables: { tag: env.CF_ACCOUNT_ID, since: sinceDate, until: untilDate } }),
    });
    const json = await res.json<any>();
    if (!res.ok || json?.errors?.length || !json?.data?.viewer?.accounts?.length) {
      const msg = json?.errors?.[0]?.message || `Cloudflare API ${res.status}`;
      return { ...base, reason: msg };
    }
    account = json.data.viewer.accounts[0];
  } catch (e: any) {
    return { ...base, reason: e?.message || 'Cloudflare API request failed' };
  }

  const sumField = (arr: any[], path: string): number =>
    (arr || []).reduce((acc, row) => acc + (Number(row?.sum?.[path]) || 0), 0);
  const sumByAction = (arr: any[], actions: string[]): number =>
    (arr || [])
      .filter((row) => actions.includes((row?.dimensions?.actionType || '').toLowerCase()))
      .reduce((acc, row) => acc + (Number(row?.sum?.requests) || 0), 0);

  const workersRequests = sumField(account.workersInvocationsAdaptive, 'requests');
  const d1RowsRead = sumField(account.d1AnalyticsAdaptiveGroups, 'rowsRead');
  const d1RowsWritten = sumField(account.d1AnalyticsAdaptiveGroups, 'rowsWritten');
  // R2 Class A = writes/lists, Class B = reads. Action names vary; bucket by keyword.
  const r2 = account.r2OperationsAdaptiveGroups || [];
  const r2ClassA = (r2 as any[])
    .filter((r) => /put|post|list|delete|create/i.test(r?.dimensions?.actionType || ''))
    .reduce((a, r) => a + (Number(r?.sum?.requests) || 0), 0);
  const r2ClassB = (r2 as any[])
    .filter((r) => /get|head/i.test(r?.dimensions?.actionType || ''))
    .reduce((a, r) => a + (Number(r?.sum?.requests) || 0), 0);
  const kv = account.kvOperationsAdaptiveGroups || [];
  const kvReads = sumByAction(kv, ['read']);
  const kvWrites = (kv as any[])
    .filter((r) => /write|delete|list/i.test(r?.dimensions?.actionType || ''))
    .reduce((a, r) => a + (Number(r?.sum?.requests) || 0), 0);

  // Pro-rate monthly included allowances to the queried window.
  const frac = days / 30;
  const over = (used: number, included: number) => Math.max(used - included * frac, 0);
  const perM = (n: number, rate: number) => (n / 1_000_000) * rate;

  const lines: CloudflareUsage['lines'] = [];
  const planFee = CF_PRICING.workersPlanMonthly * frac;
  lines.push({ label: 'Workers plan', detail: `$${CF_PRICING.workersPlanMonthly}/mo prorated`, costUsd: planFee });

  const workersCost = perM(over(workersRequests, CF_PRICING.workersIncludedRequests), CF_PRICING.workersPerMillionRequests);
  lines.push({ label: 'Workers requests', detail: fmtN(workersRequests), costUsd: workersCost });

  const d1ReadCost = perM(over(d1RowsRead, CF_PRICING.d1IncludedRowsRead), CF_PRICING.d1RowsReadPerMillion);
  const d1WriteCost = perM(over(d1RowsWritten, CF_PRICING.d1IncludedRowsWritten), CF_PRICING.d1RowsWrittenPerMillion);
  lines.push({ label: 'D1 rows', detail: `${fmtN(d1RowsRead)} read / ${fmtN(d1RowsWritten)} written`, costUsd: d1ReadCost + d1WriteCost });

  const r2ACost = perM(over(r2ClassA, CF_PRICING.r2IncludedClassA), CF_PRICING.r2ClassAPerMillion);
  const r2BCost = perM(over(r2ClassB, CF_PRICING.r2IncludedClassB), CF_PRICING.r2ClassBPerMillion);
  lines.push({ label: 'R2 operations', detail: `${fmtN(r2ClassA)} A / ${fmtN(r2ClassB)} B`, costUsd: r2ACost + r2BCost });

  const kvCost = perM(kvReads, CF_PRICING.kvReadsPerMillion) + perM(kvWrites, CF_PRICING.kvWritesPerMillion);
  lines.push({ label: 'KV operations', detail: `${fmtN(kvReads)} read / ${fmtN(kvWrites)} write`, costUsd: kvCost });

  const totalUsd = lines.reduce((a, l) => a + l.costUsd, 0);

  const result: CloudflareUsage = {
    available: true,
    periodDays: days,
    workersRequests,
    d1RowsRead,
    d1RowsWritten,
    r2ClassA,
    r2ClassB,
    kvReads,
    kvWrites,
    lines,
    totalUsd,
  };

  if (env.PROXY_CACHE) {
    await env.PROXY_CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 600 }).catch(() => {});
  }
  return result;
}

function fmtN(n: number): string {
  return (n || 0).toLocaleString('en-US');
}
