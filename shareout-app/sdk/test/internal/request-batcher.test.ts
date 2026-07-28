import { afterEach, describe, expect, it, vi } from 'vitest';
import { RequestBatcher, type DirectFetchClient } from '../../src/internal/request-batcher';
import { ShareOutError } from '../../src/shareout-error';

function createClient(fetchImpl: DirectFetchClient['_directFetch']): DirectFetchClient {
  return { _directFetch: fetchImpl };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('RequestBatcher', () => {
  it('bypasses batching for non-GET requests', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    const batcher = new RequestBatcher(createClient(fetchMock));

    await expect(batcher.batch('/json/settings', 'PUT', { theme: 'dark' })).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith('/json/settings', {
      method: 'PUT',
      body: JSON.stringify({ theme: 'dark' }),
    });
  });

  it('flushes a single GET without batch endpoint', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => ({ value: 1 }));
    const batcher = new RequestBatcher(createClient(fetchMock), 10);

    const resultPromise = batcher.batch('/json/one');
    await vi.advanceTimersByTimeAsync(10);

    await expect(resultPromise).resolves.toEqual({ value: 1 });
    expect(fetchMock).toHaveBeenCalledWith('/json/one', { method: 'GET', body: undefined });
  });

  it('batches multiple GET requests', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => ({
      results: [
        { path: '/json/one', success: true, data: { value: 1 } },
        { path: '/json/two', success: true, data: { value: 2 } },
      ],
    }));
    const batcher = new RequestBatcher(createClient(fetchMock), 10);

    const one = batcher.batch('/json/one');
    const two = batcher.batch('/json/two');
    await vi.advanceTimersByTimeAsync(10);

    await expect(Promise.all([one, two])).resolves.toEqual([{ value: 1 }, { value: 2 }]);
    expect(fetchMock).toHaveBeenCalledWith('/batch', expect.objectContaining({ method: 'POST' }));
  });

  it('rejects failed batch items with ShareOutError', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => ({
      results: [
        { path: '/json/one', success: true, data: { value: 1 } },
        { path: '/json/two', success: false, error: 'Missing', code: 'KEY_NOT_FOUND' },
      ],
    }));
    const batcher = new RequestBatcher(createClient(fetchMock), 10);

    const one = batcher.batch('/json/one');
    const two = batcher.batch('/json/two').catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10);

    await expect(one).resolves.toEqual({ value: 1 });
    await expect(two).resolves.toMatchObject({
      name: 'ShareOutError',
      message: 'Missing',
      code: 'KEY_NOT_FOUND',
    });
  });

  it('rejects all queued requests when the batch call fails', async () => {
    vi.useFakeTimers();
    const batchError = new ShareOutError('Server error', 'INTERNAL', 500);
    const fetchMock = vi.fn(async () => {
      throw batchError;
    });
    const batcher = new RequestBatcher(createClient(fetchMock), 10);

    const one = batcher.batch('/json/one').catch((error: unknown) => error);
    const two = batcher.batch('/json/two').catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10);

    await expect(one).resolves.toBe(batchError);
    await expect(two).resolves.toBe(batchError);
  });

  it('flushes immediately when queue reaches max batch size', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => ({
      results: Array.from({ length: 20 }, (_, i) => ({
        path: `/json/${i}`,
        success: true,
        data: { value: i },
      })),
    }));
    const batcher = new RequestBatcher(createClient(fetchMock), 1000);

    const requests = Array.from({ length: 20 }, (_, i) => batcher.batch(`/json/${i}`));
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(Promise.all(requests)).resolves.toHaveLength(20);
  });
});
