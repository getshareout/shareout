interface CacheEntry<T> {
  data: T;
  timestamp: number;
  etag?: string;
}

export class SWRCache {
  private cache = new Map<string, CacheEntry<unknown>>();
  private revalidating = new Set<string>();

  constructor(private ttl: number = 60000) {}

  get<T>(key: string): { data: T; stale: boolean } | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const age = Date.now() - entry.timestamp;
    return {
      data: entry.data as T,
      stale: age > this.ttl,
    };
  }

  set<T>(key: string, data: T, etag?: string): void {
    this.cache.set(key, { data, timestamp: Date.now(), etag });
  }

  isRevalidating(key: string): boolean {
    return this.revalidating.has(key);
  }

  startRevalidation(key: string): void {
    this.revalidating.add(key);
  }

  endRevalidation(key: string): void {
    this.revalidating.delete(key);
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }

  invalidatePrefix(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  clear(): void {
    this.cache.clear();
    this.revalidating.clear();
  }

  get stats() {
    return {
      size: this.cache.size,
      revalidating: this.revalidating.size,
    };
  }
}

