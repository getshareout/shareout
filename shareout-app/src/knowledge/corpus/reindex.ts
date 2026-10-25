// Force re-learning a workspace's corpus (POST …/knowledge/reindex), its per-source
// status (GET …/knowledge/status → corpus), and the nightly refresh of sources chunked
// by an older chunker or stuck in `failed`. All of it goes through forceIngest, so the
// Workflow / inline paths and their metering are the same as a normal publish.
import type { Env } from '../../types';
import { JSON_IN, jsonList } from '../../sql-in';
import { corpusFor, type SourceKind, type SourceMeta, type SourceStats } from './client';
import { forceIngest, type IngestParams } from './ingest';
import { CHUNKER_VERSION } from './sections';
import { visibleSources } from './search';
import { workspaceOverBudget } from '../../data/ai-budget';

export const REINDEX_WINDOW_MS = 10 * 60 * 1000;
export const REINDEX_MAX = 300;

interface Eligible extends SourceMeta { kind: SourceKind }

/** Live pages (approved or never moderated) and Files of a workspace, optionally only `ids`. */
async function eligibleSources(env: Env, workspaceId: string, ids: string[] | null): Promise<Eligible[]> {
  const only = ids ? ` AND a.id IN ${JSON_IN}` : '';
  const onlyFiles = ids ? ` AND d.id IN ${JSON_IN}` : '';
  const pages = (await env.DB.prepare(
    `SELECT a.id, a.name, a.owner_id, dep.version_id AS version FROM artifacts a
       JOIN deployments dep ON dep.artifact_id = a.id AND dep.channel = 'production'
       LEFT JOIN artifact_moderation m ON m.artifact_id = a.id
      WHERE a.workspace_id = ? AND a.deleted_at IS NULL AND COALESCE(m.status, 'approved') = 'approved'${only}
      ORDER BY a.created_at DESC`,
  ).bind(workspaceId, ...(ids ? [jsonList(ids)] : [])).all<{ id: string; name: string; owner_id: string; version: string | null }>()).results || [];
  const files = (await env.DB.prepare(
    `SELECT d.id, d.name, d.owner_id,
            (SELECT b.id FROM blobs b WHERE b.deliverable_id = d.id ORDER BY b.version_no DESC LIMIT 1) AS version
       FROM asset_deliverables d WHERE d.workspace_id = ? AND d.deleted_at IS NULL${onlyFiles}`,
  ).bind(workspaceId, ...(ids ? [jsonList(ids)] : [])).all<{ id: string; name: string; owner_id: string; version: string | null }>()).results || [];
  const out: Eligible[] = [];
  for (const [kind, list] of [['page', pages], ['asset', files]] as const) {
    for (const r of list) {
      if (r.version) out.push({ refId: r.id, kind, version: r.version, title: r.name ?? r.id, ownerId: r.owner_id ?? null });
    }
  }
  return out;
}

export type ReindexResult =
  | { ok: true; queued: number; remaining: number; skipped: string[] }
  | { ok: false; retryAfterSec: number };

/**
 * Re-learn every eligible source (or just `artifactIds`) even at an unchanged version.
 * At most one call per workspace per REINDEX_WINDOW_MS, claimed in the workspace's store.
 */
export async function reindexWorkspace(
  env: Env,
  ctx: { waitUntil(p: Promise<unknown>): void } | undefined,
  workspaceId: string,
  artifactIds: string[] | null,
): Promise<ReindexResult> {
  const store = corpusFor(env, workspaceId)!;
  const claim = await store.claimReindex(REINDEX_WINDOW_MS);
  if (!claim.ok) return claim;
  const all = await eligibleSources(env, workspaceId, artifactIds);
  const batch = all.slice(0, REINDEX_MAX);
  const found = new Set(all.map((s) => s.refId));
  await store.markQueued(batch);
  await forceIngest(env, ctx, batch.map((s) => ({ workspaceId, kind: s.kind, refId: s.refId })));
  return {
    ok: true,
    queued: batch.length,
    remaining: all.length - batch.length,
    skipped: (artifactIds ?? []).filter((id) => !found.has(id)),
  };
}

const STATUS_LABEL = { processing: 'queued', ready: 'ready', failed: 'failed', unsupported: 'unsupported' } as const;

export interface CorpusSourceStatus {
  id: string;
  kind: SourceKind;
  title: string;
  status: (typeof STATUS_LABEL)[keyof typeof STATUS_LABEL];
  version: string;
  chunker_version: number;
  outdated: boolean;
  chunks: number;
  chunks_with_page: number;
  chunks_with_anchor: number;
  error: string | null;
  updated_at: string;
}

export interface CorpusStatus {
  chunker_version: number;
  last_reindex_at: string | null;
  counts: Record<CorpusSourceStatus['status'], number>;
  sources: CorpusSourceStatus[];
}

/** Per-source corpus status. `userId` = a member: only sources they may open; null = all. */
export async function corpusStatus(env: Env, workspaceId: string, userId: string | null, limit = 500): Promise<CorpusStatus | null> {
  const store = corpusFor(env, workspaceId);
  if (!store) return null;
  const [rows, last] = await Promise.all([store.sourceStats(limit), store.lastReindexAt()]);
  let shown: SourceStats[] = rows;
  if (userId) {
    const { visible } = await visibleSources(env, workspaceId, userId, rows);
    shown = rows.filter((r) => visible.has(r.refId));
  }
  const counts = { queued: 0, ready: 0, failed: 0, unsupported: 0 };
  const sources = shown.map((r): CorpusSourceStatus => {
    const status = STATUS_LABEL[r.status];
    counts[status]++;
    return {
      id: r.refId,
      kind: r.kind,
      title: r.title,
      status,
      version: r.version,
      chunker_version: r.chunkerVersion,
      outdated: r.chunkerVersion < CHUNKER_VERSION,
      chunks: r.chunkCount,
      chunks_with_page: r.withPage,
      chunks_with_anchor: r.withAnchor,
      error: r.error,
      updated_at: r.updatedAt,
    };
  });
  return { chunker_version: CHUNKER_VERSION, last_reindex_at: last, counts, sources };
}

// Nightly refresh caps, in the spirit of consolidate.ts: bounded per workspace and per run.
export const REFRESH_MAX_PER_WS = 10;
export const REFRESH_MAX_PER_RUN = 60;
export const REFRESH_MAX_WORKSPACES = 50;
export const REFRESH_MAX_FAILS = 5;

export interface RefreshResult { workspaces: number; queued: number; outdated: number; failed: number }

/**
 * Re-learn sources chunked by an older CHUNKER_VERSION, and failed ones past their
 * backoff, across Knowledge-enabled workspaces. Runs from the 03:00 UTC knowledge pass.
 */
export async function runCorpusRefresh(
  env: Env,
  opts: { perWorkspace?: number; perRun?: number; maxWorkspaces?: number } = {},
): Promise<RefreshResult> {
  const result: RefreshResult = { workspaces: 0, queued: 0, outdated: 0, failed: 0 };
  if (!env.KNOWLEDGE_STORE) return result;
  const perWs = opts.perWorkspace ?? REFRESH_MAX_PER_WS;
  const perRun = opts.perRun ?? REFRESH_MAX_PER_RUN;
  const wsRows = (await env.DB.prepare(
    'SELECT workspace_id FROM knowledge_settings WHERE enabled = 1 ORDER BY workspace_id LIMIT ?',
  ).bind(opts.maxWorkspaces ?? REFRESH_MAX_WORKSPACES).all<{ workspace_id: string }>()).results || [];
  for (const { workspace_id: workspaceId } of wsRows) {
    const budget = Math.min(perWs, perRun - result.queued);
    if (budget <= 0) break;
    if (await workspaceOverBudget(env, workspaceId).catch(() => false)) continue;
    const store = corpusFor(env, workspaceId)!;
    const stale = await store.staleSources(CHUNKER_VERSION, budget, REFRESH_MAX_FAILS).catch(() => []);
    if (!stale.length) continue;
    const items: IngestParams[] = stale.map((s) => ({ workspaceId, kind: s.kind, refId: s.refId }));
    await forceIngest(env, undefined, items);
    result.workspaces++;
    result.queued += stale.length;
    for (const s of stale) result[s.reason === 'failed' ? 'failed' : 'outdated']++;
  }
  return result;
}
