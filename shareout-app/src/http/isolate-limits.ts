// Per-isolate, in-memory guards for hot public write paths (analytics beats, view
// counters). No I/O, so they cost nothing per request — but they are best-effort:
// each isolate keeps its own map, so traffic spread over many isolates is cut per
// isolate, not globally. Use the KV limiter in rate-limit.ts where a global bound
// matters more than the write it costs.

const registry = new Set<{ clear(): void }>();

/** Clears every guard in this isolate (tests). */
export function resetIsolateLimits(): void {
  for (const r of registry) r.clear();
}

/** Remembers keys for `ttlMs`; oldest entries are dropped past `max`. */
export class RecentKeys<V = true> {
  private entries = new Map<string, { until: number; value: V }>();

  constructor(private ttlMs: number, private max = 5_000) {
    registry.add(this);
  }

  get(key: string, now = Date.now()): V | undefined {
    const e = this.entries.get(key);
    if (!e) return undefined;
    if (e.until > now) return e.value;
    this.entries.delete(key);
    return undefined;
  }

  set(key: string, value: V, now = Date.now()): void {
    this.entries.delete(key);
    if (this.entries.size >= this.max) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { until: now + this.ttlMs, value });
  }

  /** True if `key` was seen inside the window; otherwise records it and returns false. */
  seen(key: string, now = Date.now()): boolean {
    if (this.get(key, now) !== undefined) return true;
    this.set(key, true as V, now);
    return false;
  }

  clear(): void {
    this.entries.clear();
  }
}

/** Fixed-window counter: at most `limit` hits per key per `windowMs`. */
export class WindowLimiter {
  private windows: RecentKeys<{ count: number }>;

  constructor(private limit: number, windowMs: number, max = 5_000) {
    this.windows = new RecentKeys<{ count: number }>(windowMs, max);
  }

  /** Counts a hit; false once the key is over its limit for the current window. */
  hit(key: string, now = Date.now()): boolean {
    const w = this.windows.get(key, now);
    if (!w) {
      this.windows.set(key, { count: 1 }, now);
      return true;
    }
    if (w.count >= this.limit) return false;
    w.count++;
    return true;
  }
}
