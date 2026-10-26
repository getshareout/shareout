// On-demand Knowledge learning that runs to the end. "Learn from existing pages" used to
// get one bounded pass in waitUntil (≤10 pages, ~25s) and leave the rest to the hourly
// cron (5 per workspace per hour): a 160-page backfill took more than a day. Here a
// KnowledgeIngestWorkflow instance in `distill` mode drains the workspace's queue in
// retried steps instead. No new binding: it reuses KNOWLEDGE_INGEST.
import type { Env } from '../types';
import type { IngestParams } from './corpus/ingest';
import type { VectorBackfillParams } from './vectors/backfill';

export interface DistillDrainParams { kind: 'distill'; workspaceId: string }
/** The KNOWLEDGE_INGEST Workflow's three modes: learn one source, drain the distill queue, backfill the v2 index. */
export type KnowledgeWorkflowParams = IngestParams | DistillDrainParams | VectorBackfillParams;

/** Pages per step: one step stays well inside a Workflow step's limits. */
export const DRAIN_BATCH = 5;
/** Steps per drain (DRAIN_BATCH × this = most pages one drain learns). */
export const DRAIN_MAX_STEPS = 60;
// One drain per workspace per window: a second click while one runs is a no-op (the
// instance id already exists). A drain outliving its window can overlap the next one.
const DRAIN_WINDOW_MS = 30 * 60_000;

/** Start (or join) the workspace's drain. False when this instance has no Workflows. */
export async function startDistillDrain(env: Env, workspaceId: string, now = Date.now()): Promise<boolean> {
  if (!env.KNOWLEDGE_INGEST) return false;
  const id = `distill-${workspaceId}-${Math.floor(now / DRAIN_WINDOW_MS)}`;
  await env.KNOWLEDGE_INGEST.create({ id, params: { kind: 'distill', workspaceId } }).catch(() => {});
  return true;
}
