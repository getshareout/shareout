import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SWRCache } from '../../src/internal/swr-cache';

describe('SWRCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null for missing keys', () => {
    const cache = new SWRCache();
    expect(cache.get('missing')).toBeNull();
  });

  it('stores and retrieves fresh entries', () => {
    const cache = new SWRCache(1000);
    cache.set('key', { value: 42 });

    const entry = cache.get<{ value: number }>('key');
    expect(entry).toEqual({ data: { value: 42 }, stale: false });
  });

  it('marks entries stale after TTL', () => {
    const cache = new SWRCache(1000);
    cache.set('key', 'data');

    vi.advanceTimersByTime(1001);

    const entry = cache.get<string>('key');
    expect(entry?.stale).toBe(true);
  });

  it('tracks revalidation state', () => {
    const cache = new SWRCache();

    expect(cache.isRevalidating('key')).toBe(false);

    cache.startRevalidation('key');
    expect(cache.isRevalidating('key')).toBe(true);

    cache.endRevalidation('key');
    expect(cache.isRevalidating('key')).toBe(false);
  });

  it('invalidates single keys and prefixes', () => {
    const cache = new SWRCache();
    cache.set('GET:/json/a', 1);
    cache.set('GET:/json/b', 2);
    cache.set('GET:/tables/t1', 3);

    cache.invalidate('GET:/json/a');
    expect(cache.get('GET:/json/a')).toBeNull();
    expect(cache.get('GET:/json/b')).not.toBeNull();

    cache.invalidatePrefix('GET:/json');
    expect(cache.get('GET:/json/b')).toBeNull();
    expect(cache.get('GET:/tables/t1')).not.toBeNull();
  });

  it('clears all entries and revalidation flags', () => {
    const cache = new SWRCache();
    cache.set('a', 1);
    cache.startRevalidation('a');

    cache.clear();

    expect(cache.get('a')).toBeNull();
    expect(cache.isRevalidating('a')).toBe(false);
    expect(cache.stats).toEqual({ size: 0, revalidating: 0 });
  });

  it('reports cache stats', () => {
    const cache = new SWRCache();
    cache.set('a', 1);
    cache.set('b', 2);
    cache.startRevalidation('a');

    expect(cache.stats).toEqual({ size: 2, revalidating: 1 });
  });
});
