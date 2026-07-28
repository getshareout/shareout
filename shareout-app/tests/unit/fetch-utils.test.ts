// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FetchTimeoutError, fetchWithTimeout } from '../../src/fetch-utils';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('fetchWithTimeout', () => {
  it('returns the fetch response when the request completes in time', async () => {
    const response = new Response('ok', { status: 200 });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);

    const result = await fetchWithTimeout('https://api.example.com/data', { method: 'GET' }, 5000);

    expect(result).toBe(response);
    expect(fetch).toHaveBeenCalledWith('https://api.example.com/data', expect.objectContaining({
      method: 'GET',
      signal: expect.any(AbortSignal),
    }));
  });

  it('throws FetchTimeoutError when the request is aborted', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const error = new Error('Aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }));

    const pending = fetchWithTimeout('https://slow.example.com', undefined, 1000);
    const assertion = expect(pending).rejects.toBeInstanceOf(FetchTimeoutError);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
    await expect(pending).rejects.toThrow('timed out after 1000ms');
  });

  it('rethrows non-abort fetch errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('network down'));

    await expect(fetchWithTimeout('https://api.example.com')).rejects.toThrow('network down');
  });
});

describe('FetchTimeoutError', () => {
  it('sets the error name and message', () => {
    const error = new FetchTimeoutError('https://api.example.com', 5000);

    expect(error.name).toBe('FetchTimeoutError');
    expect(error.message).toBe('Request to https://api.example.com timed out after 5000ms');
  });
});
