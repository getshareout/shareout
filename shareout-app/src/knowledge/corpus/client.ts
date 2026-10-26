// Types and the stub lookup for the per-workspace knowledge store. Kept apart from the
// Durable Object class so modules loaded outside workerd (node tests) never import
// `cloudflare:workers`.
import type { Env } from '../../types';
import type { KnowledgeStore } from './store-do';

export type SourceKind = 'asset' | 'page';
export type SourceStatus = 'processing' | 'ready' | 'unsupported' | 'failed';

export interface SourceMeta {
  refId: string;
  kind: SourceKind;
  version: string;
  title: string;
  ownerId: string | null;
}

export interface SourceRow extends SourceMeta {
  status: SourceStatus;
  error: string | null;
  chunkCount: number;
  updatedAt: string;
}

export interface SourceStats extends SourceRow {
  chunkerVersion: number;
  failCount: number;
  withPage: number;
  withAnchor: number;
}

export interface ChunkHit {
  refId: string;
  kind: SourceKind;
  title: string;
  ord: number;
  locator: string;
  text: string;
  page: string | null;
  anchor: string | null;
}

/**
 * Who may see a source, as D1 last said (search.ts records it in the store): every member,
 * only its owner, or nobody (awaiting moderation, or gone). A hint for picking candidates,
 * never an access decision — every result is re-checked in D1.
 */
export type SourceAccess = 'all' | 'owner' | 'none';

/** The store's last record of a source's access; null = never checked. */
export interface CachedAccess {
  access: SourceAccess | null;
  ownerId: string | null;
}

export interface CandidateHit extends ChunkHit, CachedAccess {}

/** A source the store left out because it last saw it hidden from the member. */
export interface SkippedSource extends CachedAccess {
  refId: string;
  kind: SourceKind;
}

export interface CandidateQuery {
  /** The member searching. */
  viewer: string;
  /** Candidates wanted: the best this many chunks from sources not known to be hidden. */
  limit: number;
  /** Chunks holding every term answer alone when at least this many of them are candidates. */
  strictMin: number;
  /** Sources D1 says the member may not see: never candidates. */
  exclude?: string[];
  /** Sources D1 says the member may see: candidates whatever the store recorded. */
  include?: string[];
  /** Only sources of these kinds (default: every kind). */
  kinds?: SourceKind[];
}

export interface Candidates {
  /** Best first. */
  hits: CandidateHit[];
  /** Sources left out as hidden that had a chunk ranked above the last candidate. */
  skipped: SkippedSource[];
  /** `limit` candidates came back: more may exist. */
  full: boolean;
  /** Answered by chunks holding every term. */
  strict: boolean;
}

export function corpusFor(env: Env, workspaceId: string): DurableObjectStub<KnowledgeStore> | null {
  const ns = env.KNOWLEDGE_STORE;
  return ns ? ns.get(ns.idFromName(workspaceId)) : null;
}
