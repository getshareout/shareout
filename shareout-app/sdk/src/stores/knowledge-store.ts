import type { SdkClient } from '../core/sdk-client';

export interface KnowledgeHit {
  id: string;
  text: string;
  locator: string;
  score: number;
  source: { kind: 'page' | 'asset'; id: string; title: string; url: string | null };
  cite: string;
  page: string | null;
  anchor: string | null;
  url: string | null;
}

export interface KnowledgeSearchResult {
  query: string;
  mode: 'hybrid' | 'keyword';
  hits: KnowledgeHit[];
}

// Search the artifact's workspace Knowledge at runtime. Server-side the viewer must be a
// signed-in internal member of the workspace; hits are limited to what they can open.
export class KnowledgeStore {
  constructor(private sdk: SdkClient) {}

  search(query: string, opts: { limit?: number; full?: boolean } = {}): Promise<KnowledgeSearchResult> {
    const params = new URLSearchParams({ q: query });
    if (opts.limit) params.set('limit', String(opts.limit));
    if (opts.full) params.set('full', '1');
    return this.sdk._internalFetch(`/knowledge/search?${params}`);
  }
}
