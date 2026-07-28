/**
 * Shared Vitest mocks and per-test reset hooks for datasets handler tests.
 * Import this module first in every `datasets/*.test.ts` file.
 */
import { afterEach, beforeEach, vi } from 'vitest';
import * as middleware from '../../../../src/data/middleware';

vi.mock('../../../../src/crypto-utils', () => ({
  generateId: vi.fn((prefix: string) => `${prefix}_test123`),
  sha256: vi.fn(async () => 'abc123hash'),
}));

beforeEach(() => {
  vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
