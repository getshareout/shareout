import { getPostMessageData, type EmbeddedInitialData } from '../internal/embedded-init';
import { hashQuery } from './hash-query';
import type { SWRCache } from '../internal/swr-cache';

export function getEmbeddedData(): EmbeddedInitialData | null {
  const pm = getPostMessageData();
  if (pm) return pm;

  if (typeof document === 'undefined') return null;
  const script = document.getElementById('shareout-initial-data');
  if (!script) return null;
  try {
    return JSON.parse(script.textContent || '');
  } catch {
    return null;
  }
}

export function hydrateFromEmbedded(
  cache: SWRCache,
  json: Record<string, unknown>
): void {
  for (const [key, value] of Object.entries(json)) {
    const cacheKey = `GET:/json/${encodeURIComponent(key)}`;
    cache.set(cacheKey, { key, value, updatedAt: new Date().toISOString() });
  }
}

export function hydrateTablesFromEmbedded(
  cache: SWRCache,
  tables: Record<string, { rows: unknown[]; total: number; hasMore: boolean }>
): void {
  for (const [tableName, data] of Object.entries(tables)) {
    const queryBody = JSON.stringify({ filter: {}, sort: {}, limit: 100, skip: 0 });
    const cacheKey = `POST:/tables/${encodeURIComponent(tableName)}/query:${hashQuery(queryBody)}`;
    cache.set(cacheKey, data);
  }
}

/** Per-artifact CDN host: `<hex>.shareoutcdn.site` → `art_<hex>` (ADR 30). */
export function artifactIdFromCdnHostname(hostname: string): string {
  if (!hostname) return '';
  const m = hostname.match(/^([a-f0-9]+)\.shareoutcdn\.site$/i);
  return m ? `art_${m[1]}` : '';
}

export function detectArtifactId(): string {
  if (typeof window === 'undefined') return '';

  const fromCdn = artifactIdFromCdnHostname(window.location.hostname);
  if (fromCdn) return fromCdn;

  let pathParts = window.location.pathname.split('/').filter(Boolean);
  // Gated CDN URLs carry `/c/<capability-token>/…` — never treat `c` as a slug.
  if (pathParts[0] === 'c' && pathParts.length >= 2) {
    pathParts = pathParts.slice(2);
  }

  if (pathParts.length >= 2 && (pathParts[0] === 'a' || pathParts[0] === 'embed' || pathParts[0] === 'p')) {
    return pathParts[1];
  }

  const reserved = new Set(['workspace', 'v1', 'sdk', 'auth', 'api', 'c']);
  if (pathParts.length >= 1 && !reserved.has(pathParts[0])) {
    return pathParts[0];
  }

  return '';
}

export function detectBaseUrl(): string {
  if (typeof window === 'undefined') return '';

  // The data API always lives on the app origin, not the per-artifact CDN host.
  if (artifactIdFromCdnHostname(window.location.hostname)) {
    const scripts = document.querySelectorAll('script[src*="shareout"]');
    for (let i = 0; i < scripts.length; i++) {
      const src = scripts[i].getAttribute('src');
      if (!src) continue;
      try {
        const url = new URL(src, window.location.href);
        if (!url.hostname.endsWith('shareoutcdn.site')) return url.origin;
      } catch {}
    }
    return 'https://shareout.site';
  }

  const scripts = document.querySelectorAll('script[src*="shareout"]');
  for (let i = 0; i < scripts.length; i++) {
    const src = scripts[i].getAttribute('src');
    if (src) {
      try {
        const url = new URL(src, window.location.href);
        return url.origin;
      } catch {}
    }
  }
  return window.location.origin;
}
