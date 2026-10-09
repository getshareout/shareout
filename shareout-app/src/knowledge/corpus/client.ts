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

export interface ChunkHit {
  refId: string;
  kind: SourceKind;
  title: string;
  ord: number;
  locator: string;
  text: string;
}

export function corpusFor(env: Env, workspaceId: string): DurableObjectStub<KnowledgeStore> | null {
  const ns = env.KNOWLEDGE_STORE;
  return ns ? ns.get(ns.idFromName(workspaceId)) : null;
}
