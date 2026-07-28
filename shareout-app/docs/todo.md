# ShareOut Progressive Loading - TODO

## Completed

### Phase 1: Quick Wins
- [x] Combined DB queries with LEFT JOIN (serve.ts)
- [x] Added preload hints for CSS/JS/fonts in wrapper HTML
- [x] Added KV cache layer for deployment lookups (60s TTL)
- [x] Added cache invalidation on publish
- [x] Updated types.ts with SLUGS KVNamespace

### Phase 2: Enhanced Manifest
- [x] Asset priority classification (critical/high/normal/lazy)
- [x] Enhanced manifest schema (version 2)
- [x] Inline critical CSS (<4KB) in wrapper HTML
- [x] Smart preload hints from manifest data

### Phase 3: SDK Improvements
- [x] Request batching (`/v1/data/{artifactId}/batch` endpoint)
- [x] Request deduplication (in-flight request tracking)
- [x] Client-side SWR cache (stale-while-revalidate)
- [x] Prefetch API (`sdk.prefetch([paths])`)

### Phase 4: Advanced Optimizations
- [x] Streaming HTML with TransformStream (early flush `<head>`)
- [x] Service worker for offline-first caching (`sdk/src/sw.ts`)
- [x] Embed initial JSON store data in HTML
- [x] R2 edge caching via Cloudflare Cache API

### Comments Module
- [x] Database migration (0008_comments.sql)
- [x] Backend handler (src/data/comments.ts)
- [x] Router integration (src/data/router.ts)
- [x] CommentsCoordinator Durable Object (src/realtime/comments-coordinator.ts)
- [x] Wrangler config (COMMENTS binding + v2 migration)
- [x] SDK CommentsStore class (sdk/src/index.ts)

---

### Google OAuth Configuration
- [x] Create Google Cloud OAuth credentials (console.cloud.google.com)
- [x] Set client ID: `wrangler secret put GOOGLE_CLIENT_ID`
- [x] Set client secret: `wrangler secret put GOOGLE_CLIENT_SECRET`
- [x] Add authorized redirect URI: `https://shareout.site/auth/callback`

### Google Sheets Import/Export
- [x] Database migration (0013_google_sheets.sql)
- [x] Google OAuth helper (src/data/sheets/google-auth.ts)
- [x] Sheets handler (src/data/sheets/handler.ts)
- [x] Router integration (src/data/router.ts)
- [x] SDK SheetsStore class (sdk/src/index.ts)
- [x] Deploy worker with new features

### Secrets Proxy Module
- [x] Run DB migration: `wrangler d1 migrations apply shareout-db`
- [x] Deploy worker: `wrangler deploy`
- [x] Create test secret and verify proxy works
- [x] Verify blocklist rejects localhost/internal IPs
- [x] Verify path/method restrictions work
- [x] Check audit log is populated

### Comments Module (Testing)
- [x] Run DB migration
- [x] Deploy worker
- [x] Test comments API endpoints
- [x] Test real-time WebSocket updates

### Infrastructure
- [x] Create KV namespace (id: e220a0f12d0d49919b8918b8abe716eb)
- [x] Update wrangler.toml with KV namespace ID
- [x] Deploy and verify performance improvements

### Additional Migrations
- [x] 0010_collaborators.sql
- [x] 0011_allow_null_email.sql
- [x] 0012_workspaces.sql

---

## Implementation Details

### KV Namespace Setup
```bash
cd shareout-app
wrangler kv:namespace create "SLUGS"
# Copy the returned ID to wrangler.toml
```

### Phase 3: SDK Batch Endpoint
```typescript
// POST /v1/data/{artifactId}/batch
// Body: { requests: ["/json/key1", "/tables/users/query", ...] }
// Response: { "/json/key1": {...}, "/tables/users/query": [...] }
```

### Phase 3: Request Deduplication
```typescript
class Deduplicator {
  private inflight = new Map<string, Promise<unknown>>();

  async dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (this.inflight.has(key)) return this.inflight.get(key) as Promise<T>;
    const p = fn().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }
}
```

### Phase 3: SWR Cache
```typescript
class DataCache {
  private cache = new Map<string, { data: unknown; ts: number }>();
  private TTL = 60000; // 1 minute

  get<T>(key: string): { data: T; stale: boolean } | null {
    const e = this.cache.get(key);
    if (!e) return null;
    return { data: e.data as T, stale: Date.now() - e.ts > this.TTL };
  }
}
```

### Phase 4: Streaming HTML
```typescript
function streamHTML(env: Env, slug: string): Response {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // Flush head immediately
  writer.write(encoder.encode('<!DOCTYPE html><html><head>...'));

  // Continue with body async
  (async () => {
    writer.write(encoder.encode('<body>...'));
    writer.close();
  })();

  return new Response(readable, {
    headers: { 'Content-Type': 'text/html' }
  });
}
```

### Phase 4: Service Worker
```typescript
// sdk/src/sw.ts
const CACHE_NAME = 'shareout-v1';

self.addEventListener('fetch', (event) => {
  if (url.pathname.startsWith('/a/')) {
    event.respondWith(cacheFirst(event.request));
  }
});
```

---

## Performance Targets

| Metric | Before | Phase 1 | Phase 2 | Phase 3 | Phase 4 |
|--------|--------|---------|---------|---------|---------|
| TTFB | ~150ms | ~80ms | ~60ms | ~60ms | ~40ms |
| FCP | ~400ms | ~250ms | ~180ms | ~150ms | ~120ms |
| LCP | ~800ms | ~500ms | ~350ms | ~280ms | ~200ms |
| Lighthouse | ~60 | ~75 | ~85 | ~90 | ~95 |

---

## Files Reference

| File | Purpose |
|------|---------|
| src/serve.ts | Asset serving, streaming HTML, R2 caching, preload hints |
| src/publish.ts | Manifest generation, asset priority |
| src/types.ts | Env interface with SLUGS, COMMENTS |
| sdk/src/index.ts | Client SDK (Phase 3 + Comments + embedded data hydration) |
| sdk/src/sw.ts | Service worker for offline-first caching |
| src/data/router.ts | Batch endpoint, comments routing |
| wrangler.toml | KV namespace, DO bindings |
| migrations/0000_baseline.sql | Comments tables (section 05) |
| src/data/comments.ts | Comments API handler |
| src/realtime/comments-coordinator.ts | Real-time WebSocket DO |
| migrations/0000_baseline.sql | Secrets proxy tables (section 04) |
| src/data/secrets/handler.ts | Secrets proxy API handler |
| src/data/secrets/blocklist.ts | Internal IP/host blocklist |
| src/data/secrets/path-matcher.ts | Glob pattern path matching |
| migrations/0000_baseline.sql | Google Sheets connection tables (section 04) |
| src/data/sheets/google-auth.ts | Google OAuth token management |
| src/data/sheets/handler.ts | Sheets import/export API handler |
