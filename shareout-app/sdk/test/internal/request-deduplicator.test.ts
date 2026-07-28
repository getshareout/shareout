import { describe, expect, it, vi } from 'vitest';
import { RequestDeduplicator } from '../../src/internal/request-deduplicator';

describe('RequestDeduplicator', () => {
  it('deduplicates concurrent requests with the same key', async () => {
    const deduplicator = new RequestDeduplicator();
    const fn = vi.fn(async () => 'result');

    const [first, second] = await Promise.all([
      deduplicator.dedupe('key', fn),
      deduplicator.dedupe('key', fn),
    ]);

    expect(first).toBe('result');
    expect(second).toBe('result');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('runs separate functions for different keys', async () => {
    const deduplicator = new RequestDeduplicator();
    const fnA = vi.fn(async () => 'a');
    const fnB = vi.fn(async () => 'b');

    const [a, b] = await Promise.all([
      deduplicator.dedupe('a', fnA),
      deduplicator.dedupe('b', fnB),
    ]);

    expect(a).toBe('a');
    expect(b).toBe('b');
    expect(fnA).toHaveBeenCalledTimes(1);
    expect(fnB).toHaveBeenCalledTimes(1);
  });

  it('allows a new request after the previous one completes', async () => {
    const deduplicator = new RequestDeduplicator();
    const fn = vi.fn(async () => 'done');

    await deduplicator.dedupe('key', fn);
    await deduplicator.dedupe('key', fn);

    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('clears in-flight requests', async () => {
    const deduplicator = new RequestDeduplicator();
    let resolveFn: (value: string) => void = () => {};
    const fn = vi.fn(() => new Promise<string>((resolve) => {
      resolveFn = resolve;
    }));

    const pending = deduplicator.dedupe('key', fn);
    deduplicator.clear();
    resolveFn('ok');

    await expect(pending).resolves.toBe('ok');
  });
});
