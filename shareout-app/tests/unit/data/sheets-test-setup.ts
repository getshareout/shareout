/**
 * Shared Vitest mocks and per-test reset hooks for sheets handler tests.
 * Import this module first in every `sheets-*.test.ts` file, then import
 * mocked modules (`auth`, `googleAuth`, `decryptCredentials`) from their
 * source paths so `vi.mocked()` receives the mock implementations.
 */
import { afterEach, beforeEach, vi } from 'vitest';

const mockDecryptCredentials = vi.hoisted(() => vi.fn());

let idSeq = 0;

vi.mock('../../../src/data/connections/credentials', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/data/connections/credentials')>();
  return {
    ...actual,
    decryptCredentials: mockDecryptCredentials,
  };
});

vi.mock('../../../src/crypto-utils', () => ({
  generateId: vi.fn((prefix: string) => `${prefix}_id${++idSeq}`),
}));

vi.mock('../../../src/auth', () => ({
  getSessionUser: vi.fn(),
}));

vi.mock('../../../src/data/minidb-client', () => ({
  createMiniDb: (env: { DB: unknown }) => env.DB,
}));

vi.mock('../../../src/data/sheets/google-auth', () => ({
  getGoogleAuthUrl: vi.fn(
    (_env: unknown, redirectPath: string, state: string) =>
      `https://accounts.google.com/mock?redirect=${encodeURIComponent(redirectPath)}&state=${state}`,
  ),
  exchangeCodeForTokens: vi.fn(),
  storeUserTokens: vi.fn(),
  getValidAccessToken: vi.fn(),
  hasGoogleConnection: vi.fn(),
  revokeGoogleConnection: vi.fn(),
  refreshAccessToken: vi.fn(),
}));

beforeEach(async () => {
  idSeq = 0;
  const actual = await vi.importActual<typeof import('../../../src/data/connections/credentials')>(
    '../../../src/data/connections/credentials',
  );
  mockDecryptCredentials.mockImplementation(actual.decryptCredentials);
  const auth = await import('../../../src/auth');
  const googleAuth = await import('../../../src/data/sheets/google-auth');
  vi.mocked(auth.getSessionUser).mockResolvedValue(null);
  vi.mocked(googleAuth.getValidAccessToken).mockResolvedValue(null);
  vi.mocked(googleAuth.hasGoogleConnection).mockResolvedValue(false);
  vi.mocked(googleAuth.exchangeCodeForTokens).mockResolvedValue({
    access_token: 'oauth-access',
    refresh_token: 'oauth-refresh',
    expires_in: 3600,
    token_type: 'Bearer',
    scope: 'sheets',
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
