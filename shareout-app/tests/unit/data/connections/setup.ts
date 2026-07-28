// @vitest-environment node
/**
 * Shared Vitest mocks and per-test reset hooks for connections handler tests.
 *
 * Import this module first in every `connections/*.test.ts` file, then import
 * mocked modules from their source paths so `vi.mocked()` receives the mocks.
 *
 * @module tests/unit/data/connections/setup
 */
import { afterEach, beforeEach, vi } from 'vitest';
import { resetRateLimit } from '../../../../src/data/connections/rate-limiter';
import * as middleware from '../../../../src/data/middleware';
import { fetchWithTimeout } from '../../../../src/fetch-utils';

let idSeq = 0;

vi.mock('../../../../src/crypto-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/crypto-utils')>();
  return {
    ...actual,
    generateId: vi.fn((prefix: string) => `${prefix}_id${++idSeq}`),
  };
});

vi.mock('../../../../src/fetch-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/fetch-utils')>();
  return {
    ...actual,
    fetchWithTimeout: vi.fn(),
  };
});

beforeEach(() => {
  idSeq = 0;
  resetRateLimit('con_sample');
  resetRateLimit('con_new');
  vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(true);
  vi.mocked(fetchWithTimeout).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
