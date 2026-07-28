// Cloudflare unit prices used to estimate infrastructure cost from usage.
// These are list prices (USD) as published by Cloudflare; edit here if your plan
// or Cloudflare's pricing changes. All "included" allowances are handled by the
// caller — these are the marginal per-unit rates.
export const CF_PRICING = {
  // Workers Paid plan flat monthly fee.
  workersPlanMonthly: 5.0,
  // Requests beyond the 10M/mo included.
  workersPerMillionRequests: 0.3,
  workersIncludedRequests: 10_000_000,
  // CPU time: $0.02 per million ms beyond 30M ms included.
  workersPerMillionCpuMs: 0.02,
  workersIncludedCpuMs: 30_000_000,

  // R2 storage $/GB-month, and operations per million.
  r2StoragePerGbMonth: 0.015,
  r2ClassAPerMillion: 4.5, // writes/lists
  r2ClassBPerMillion: 0.36, // reads
  r2IncludedStorageGb: 10,
  r2IncludedClassA: 1_000_000,
  r2IncludedClassB: 10_000_000,

  // D1 rows ($/million) and storage ($/GB-month).
  d1RowsReadPerMillion: 0.001,
  d1RowsWrittenPerMillion: 1.0,
  d1StoragePerGbMonth: 0.75,
  d1IncludedRowsRead: 25_000_000_000,
  d1IncludedRowsWritten: 50_000_000,
  d1IncludedStorageGb: 5,

  // KV operations ($/million) and storage ($/GB-month).
  kvReadsPerMillion: 0.5,
  kvWritesPerMillion: 5.0,
  kvStoragePerGbMonth: 0.5,
} as const;

export const BYTES_PER_GB = 1024 * 1024 * 1024;
export const MICRO_USD = 1_000_000;

export function bytesToGb(bytes: number): number {
  return bytes / BYTES_PER_GB;
}

/** Marginal cost of storing `bytes` in R2 for one month (beyond the free tier). */
export function r2StorageCost(bytes: number): number {
  const gb = Math.max(bytesToGb(bytes) - CF_PRICING.r2IncludedStorageGb, 0);
  return gb * CF_PRICING.r2StoragePerGbMonth;
}

const perMillion = (n: number, rate: number) => (Math.max(n, 0) / 1_000_000) * rate;

/** Gross R2 storage cost for one tenant's bytes over `days` (prorated to month). */
export function storageCostFor(bytes: number, days: number): number {
  return bytesToGb(bytes) * CF_PRICING.r2StoragePerGbMonth * (days / 30);
}

/** Serving an artifact request ≈ 1 Worker request + 1 R2 read. */
export function servingCostFor(requests: number): number {
  return (
    perMillion(requests, CF_PRICING.workersPerMillionRequests) +
    perMillion(requests, CF_PRICING.r2ClassBPerMillion)
  );
}

/** A scheduled-job run ≈ 1 Worker request + its measured CPU time. */
export function automationCostFor(runs: number, cpuMs: number): number {
  return (
    perMillion(runs, CF_PRICING.workersPerMillionRequests) +
    perMillion(cpuMs, CF_PRICING.workersPerMillionCpuMs)
  );
}
