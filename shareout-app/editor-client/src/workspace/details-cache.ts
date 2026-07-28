// Artifact details cache
import type { EditorContext } from '../editor/context';
import type { ArtifactDetails } from './details-panel';
import { loadArtifactDetails } from './details-panel';

interface CacheEntry {
  data: ArtifactDetails;
  timestamp: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let cache: CacheEntry | null = null;
let pendingFetch: Promise<ArtifactDetails> | null = null;

export async function getArtifactDetails(ctx: EditorContext, forceRefresh = false): Promise<ArtifactDetails> {
  if (!forceRefresh && cache && Date.now() - cache.timestamp < CACHE_TTL_MS) {
    return cache.data;
  }

  if (pendingFetch) {
    return pendingFetch;
  }

  pendingFetch = loadArtifactDetails(ctx)
    .then((details) => {
      cache = { data: details, timestamp: Date.now() };
      pendingFetch = null;
      return details;
    })
    .catch((err) => {
      pendingFetch = null;
      throw err;
    });

  return pendingFetch;
}

export function getCachedDetails(): ArtifactDetails | null {
  if (cache && Date.now() - cache.timestamp < CACHE_TTL_MS) {
    return cache.data;
  }
  return null;
}

export function invalidateCache(): void {
  cache = null;
}
