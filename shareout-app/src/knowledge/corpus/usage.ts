// Per-workspace metering for Knowledge. Worker-side spend (embeddings, searches,
// Workflow steps) goes to the shared ai_usage_events ledger; the workspace's
// KnowledgeStore counts its own SQLite rows and size (see store-do.ts usage_daily).
//
// Costs are Cloudflare list prices in micro-USD, before account-level free
// allowances — tracking only, nothing is billed. Checked 2026-10-09:
//   Workers AI  bge-base-en-v1.5 $0.067 / M input tokens (extraction models: extract.ts)
//   Vectorize   $0.01 / M queried dimensions, $0.05 / 100M stored dimensions
//   DO SQLite   $1.00 / M rows written, $0.001 / M rows read, $0.20 / GB-month
//   Workflows   $0.80 / 100k steps
import type { Env } from '../../types';
import { recordAiUsage } from '../../data/ai-usage';

export const EMBED_DIMENSIONS = 768;
export const PRICING = {
  asOf: '2026-10-09',
  embedTokenMicroUsd: 0.067,
  queriedDimensionMicroUsd: 0.01,
  storedDimensionMonthMicroUsd: 0.0005,
  rowWrittenMicroUsd: 1,
  rowReadMicroUsd: 0.001,
  storageGbMonthMicroUsd: 200_000,
  workflowStepMicroUsd: 8,
} as const;

/** Workers AI doesn't return token counts for embeddings; ~4 chars per token. */
export const estimateTokens = (texts: string[]) => Math.ceil(texts.reduce((n, t) => n + t.length, 0) / 4);

export const KNOWLEDGE_USAGE_KINDS = ['knowledge_embedding', 'knowledge_extraction', 'knowledge_search', 'knowledge_ingest'] as const;

type Kind = (typeof KNOWLEDGE_USAGE_KINDS)[number];

export function meterKnowledge(
  env: Env,
  workspaceId: string,
  kind: Kind,
  usage: { model: string; units: number; unitKind: string; costMicroUsd: number; source?: string; userId?: string | null },
): Promise<void> {
  return recordAiUsage(env, {
    workspaceId,
    userId: usage.userId ?? null,
    kind,
    model: usage.model,
    units: usage.units,
    unitKind: usage.unitKind,
    baseCostMicroUsd: Math.round(usage.costMicroUsd),
    source: usage.source ?? null,
  }).catch(() => {});
}

export interface UsageSummary {
  days: number;
  totalCostMicroUsd: number;
  ai: { kind: string; unitKind: string; units: number; events: number; costMicroUsd: number }[];
  storage: {
    bytes: number;
    sources: number;
    chunks: number;
    rowsRead: number;
    rowsWritten: number;
    costMicroUsd: number;
  };
  vectors: { stored: number; monthlyCostMicroUsd: number } | null;
  pricing: typeof PRICING;
}

/** Usage for the last `days` days: ledger rows + the store's own counters. */
export interface StoreUsage { bytes: number; sources: number; chunks: number; rowsRead: number; rowsWritten: number }

export async function knowledgeUsage(
  env: Env,
  workspaceId: string,
  store: { usage(days: number): Promise<StoreUsage> },
  days: number,
): Promise<UsageSummary> {
  const rows = (await env.DB.prepare(
    `SELECT kind, unit_kind, SUM(units) AS units, COUNT(*) AS events, SUM(base_cost_micro_usd) AS cost
       FROM ai_usage_events
      WHERE workspace_id = ? AND kind IN (${KNOWLEDGE_USAGE_KINDS.map(() => '?').join(',')})
        AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now', ?)
      GROUP BY kind, unit_kind ORDER BY cost DESC`,
  ).bind(workspaceId, ...KNOWLEDGE_USAGE_KINDS, `-${days} days`).all<{
    kind: string; unit_kind: string; units: number; events: number; cost: number;
  }>()).results || [];
  const ai = rows.map((r) => ({ kind: r.kind, unitKind: r.unit_kind, units: r.units, events: r.events, costMicroUsd: r.cost }));

  const s = await store.usage(days);
  // Round each part, then sum, so the total always equals the breakdown shown.
  const storageCost = Math.round(
    s.rowsWritten * PRICING.rowWrittenMicroUsd +
    s.rowsRead * PRICING.rowReadMicroUsd +
    (s.bytes / 1e9) * PRICING.storageGbMonthMicroUsd * (days / 30),
  );
  // One vector per chunk when embeddings are configured.
  const vectors = env.KNOWLEDGE_VECTORS
    ? { stored: s.chunks, monthlyCostMicroUsd: Math.round(s.chunks * EMBED_DIMENSIONS * PRICING.storedDimensionMonthMicroUsd) }
    : null;
  const vectorCost = vectors ? Math.round(vectors.monthlyCostMicroUsd * (days / 30)) : 0;

  return {
    days,
    totalCostMicroUsd: ai.reduce((n, r) => n + r.costMicroUsd, 0) + storageCost + vectorCost,
    ai,
    storage: { ...s, costMicroUsd: storageCost },
    vectors,
    pricing: PRICING,
  };
}
