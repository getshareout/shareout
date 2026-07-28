/**
 * Per-test setup for serve handler integration tests: edge-cache stub and auth reset.
 */
import { afterEach, beforeEach, vi } from 'vitest';
import * as auth from '../../../../src/auth';

/** In-memory edge cache used by cache-related serve tests. */
export let cacheStore: Map<string, Response>;

/** Wire global `caches.default` and reset auth mocks before each test. */
export function setupServeTestHooks(): void {
  beforeEach(() => {
    cacheStore = new Map();
    vi.stubGlobal('caches', {
      default: {
        match: vi.fn(async (key: Request) => cacheStore.get(key.url) ?? null),
        put: vi.fn(async (key: Request, response: Response) => {
          cacheStore.set(key.url, response.clone());
        }),
      },
    });

    vi.mocked(auth.getSessionUser).mockResolvedValue(null);
    vi.mocked(auth.verifyAccessToken).mockResolvedValue(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });
}
