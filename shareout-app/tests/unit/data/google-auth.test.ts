// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as credentials from '../../../src/data/connections/credentials';
import { encryptCredentials } from '../../../src/data/connections/credentials';
import {
  exchangeCodeForTokens,
  getGoogleAuthUrl,
  getValidAccessToken,
  hasGoogleConnection,
  refreshAccessToken,
  revokeGoogleConnection,
  storeUserTokens,
} from '../../../src/data/sheets/google-auth';
import type { Env } from '../../../src/types';

const BASE_URL = 'https://shareout.example.com';
const CREDENTIALS_KEY = 'test-credentials-key-32-chars!!';
const USER_ID = 'usr_google_test';

// One blob holds both tokens — two ciphertexts cannot share one iv.
interface GoogleTokenRow {
  encrypted_credentials: string;
  iv: string;
  expires_at: string;
}

interface DbState {
  tokens: Map<string, GoogleTokenRow>;
}

function createDbState(overrides: Partial<DbState> = {}): DbState {
  return {
    tokens: new Map(),
    ...overrides,
  };
}

function makeEnv(state: DbState, extras: Partial<Env> = {}): Env {
  const DB = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: unknown[]) => ({
        first: vi.fn(async () => {
          if (sql.includes('SELECT 1 FROM google_oauth_tokens')) {
            return state.tokens.has(args[0] as string) ? { 1: 1 } : null;
          }
          if (sql.includes('FROM google_oauth_tokens WHERE user_id')) {
            return state.tokens.get(args[0] as string) ?? null;
          }
          return null;
        }),
        run: vi.fn(async () => {
          if (sql.includes('INSERT INTO google_oauth_tokens')) {
            const [userId, encrypted, iv, expiresAt] = args as [string, string, string, string];
            state.tokens.set(userId, {
              encrypted_credentials: encrypted,
              iv,
              expires_at: expiresAt,
            });
          }
          if (sql.includes('DELETE FROM google_oauth_tokens')) {
            state.tokens.delete(args[0] as string);
          }
          return { success: true, meta: { changes: 1 } };
        }),
      })),
    })),
  } as unknown as Env['DB'];

  return {
    DB,
    SHAREOUT_BASE_URL: BASE_URL,
    GOOGLE_CLIENT_ID: 'google-client-id',
    GOOGLE_CLIENT_SECRET: 'google-client-secret',
    CREDENTIALS_KEY,
    ...extras,
  } as Env;
}

async function seedTokens(
  state: DbState,
  userId: string,
  accessToken: string,
  refreshToken: string,
  expiresAt: Date,
): Promise<void> {
  const { encrypted, iv } = await encryptCredentials(
    { access_token: accessToken, refresh_token: refreshToken },
    CREDENTIALS_KEY,
  );
  state.tokens.set(userId, {
    encrypted_credentials: encrypted,
    iv,
    expires_at: expiresAt.toISOString(),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('google-auth', () => {
  describe('getGoogleAuthUrl', () => {
    it('builds the Google OAuth authorize URL', () => {
      const env = makeEnv(createDbState());
      const url = getGoogleAuthUrl(env, '/data/sheets/callback', 'state-456');

      expect(url).toContain('https://accounts.google.com/o/oauth2/v2/auth?');
      expect(url).toContain('client_id=google-client-id');
      expect(url).toContain(encodeURIComponent(`${BASE_URL}/data/sheets/callback`));
      expect(url).toContain('response_type=code');
      expect(url).toContain(encodeURIComponent('https://www.googleapis.com/auth/spreadsheets'));
      expect(url).toContain('access_type=offline');
      expect(url).toContain('prompt=consent');
      expect(url).toContain('state=state-456');
    });
  });

  describe('exchangeCodeForTokens', () => {
    it('exchanges an authorization code for tokens', async () => {
      vi.stubGlobal('fetch', vi.fn(async (url, init) => {
        expect(String(url)).toBe('https://oauth2.googleapis.com/token');
        expect(init?.headers).toMatchObject({ 'Content-Type': 'application/x-www-form-urlencoded' });
        const body = new URLSearchParams(String(init?.body));
        expect(body.get('client_id')).toBe('google-client-id');
        expect(body.get('client_secret')).toBe('google-client-secret');
        expect(body.get('code')).toBe('auth-code');
        expect(body.get('grant_type')).toBe('authorization_code');
        expect(body.get('redirect_uri')).toBe(`${BASE_URL}/data/sheets/callback`);
        return new Response(JSON.stringify({
          access_token: 'access',
          refresh_token: 'refresh',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'https://www.googleapis.com/auth/spreadsheets',
        }), { status: 200 });
      }));

      const env = makeEnv(createDbState());
      await expect(exchangeCodeForTokens('auth-code', '/data/sheets/callback', env)).resolves.toMatchObject({
        access_token: 'access',
        refresh_token: 'refresh',
      });
    });

    it('throws when token exchange fails', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('invalid_grant', { status: 400 })));

      const env = makeEnv(createDbState());
      await expect(exchangeCodeForTokens('bad', '/cb', env)).rejects.toThrow('Token exchange failed: invalid_grant');
    });
  });

  describe('refreshAccessToken', () => {
    it('refreshes an access token', async () => {
      vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
        const body = new URLSearchParams(String(init?.body));
        expect(body.get('refresh_token')).toBe('refresh-token');
        expect(body.get('grant_type')).toBe('refresh_token');
        return new Response(JSON.stringify({
          access_token: 'new-access',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'sheets',
        }), { status: 200 });
      }));

      const env = makeEnv(createDbState());
      await expect(refreshAccessToken('refresh-token', env)).resolves.toMatchObject({
        access_token: 'new-access',
      });
    });

    it('throws when refresh fails', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('invalid', { status: 400 })));

      const env = makeEnv(createDbState());
      await expect(refreshAccessToken('bad', env)).rejects.toThrow('Token refresh failed: invalid');
    });
  });

  describe('storeUserTokens', () => {
    it('stores encrypted user tokens', async () => {
      const state = createDbState();
      const env = makeEnv(state);

      await storeUserTokens(env, USER_ID, {
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'sheets',
      });

      expect(state.tokens.has(USER_ID)).toBe(true);
      expect(state.tokens.get(USER_ID)?.expires_at).toBeTruthy();
    });

    it('stores tokens without a refresh token', async () => {
      const state = createDbState();
      const env = makeEnv(state);

      await storeUserTokens(env, USER_ID, {
        access_token: 'access-only',
        expires_in: 1800,
        token_type: 'Bearer',
        scope: 'sheets',
      });

      expect(state.tokens.has(USER_ID)).toBe(true);
    });

    it('throws when CREDENTIALS_KEY is missing', async () => {
      const env = makeEnv(createDbState(), { CREDENTIALS_KEY: undefined });

      await expect(storeUserTokens(env, USER_ID, {
        access_token: 'a',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'sheets',
      })).rejects.toThrow('CREDENTIALS_KEY not configured');
    });
  });

  describe('getValidAccessToken', () => {
    it('returns null when credentials key is missing', async () => {
      const env = makeEnv(createDbState(), { CREDENTIALS_KEY: undefined });
      await expect(getValidAccessToken(env, USER_ID)).resolves.toBeNull();
    });

    it('returns null when no tokens are stored', async () => {
      const env = makeEnv(createDbState());
      await expect(getValidAccessToken(env, USER_ID)).resolves.toBeNull();
    });

    it('returns a valid access token when not near expiry', async () => {
      const state = createDbState();
      await seedTokens(
        state,
        USER_ID,
        'valid-access',
        'refresh-token',
        new Date(Date.now() + 10 * 60_000),
      );
      const env = makeEnv(state);

      await expect(getValidAccessToken(env, USER_ID)).resolves.toBe('valid-access');
    });

    it('refreshes expired tokens and stores the new access token', async () => {
      const state = createDbState();
      await seedTokens(
        state,
        USER_ID,
        'expired-access',
        'refresh-token',
        new Date(Date.now() + 30_000),
      );
      const env = makeEnv(state);

      vi.spyOn(credentials, 'decryptCredentials').mockResolvedValue({ access_token: 'expired-access', refresh_token: 'refresh-token' });
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
        access_token: 'refreshed-access',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'sheets',
      }), { status: 200 })));

      await expect(getValidAccessToken(env, USER_ID)).resolves.toBe('refreshed-access');
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('returns null when refresh token is empty', async () => {
      const state = createDbState();
      await seedTokens(state, USER_ID, 'expired-access', '', new Date(Date.now() + 30_000));
      const env = makeEnv(state);

      vi.spyOn(credentials, 'decryptCredentials').mockResolvedValue({ access_token: 'expired-access', refresh_token: '' });

      await expect(getValidAccessToken(env, USER_ID)).resolves.toBeNull();
    });

    it('returns null when refresh fails', async () => {
      const state = createDbState();
      await seedTokens(
        state,
        USER_ID,
        'expired-access',
        'refresh-token',
        new Date(Date.now() + 30_000),
      );
      const env = makeEnv(state);

      vi.spyOn(credentials, 'decryptCredentials').mockResolvedValue({ access_token: 'expired-access', refresh_token: 'refresh-token' });
      vi.stubGlobal('fetch', vi.fn(async () => new Response('invalid_grant', { status: 400 })));

      await expect(getValidAccessToken(env, USER_ID)).resolves.toBeNull();
    });
  });

  describe('connection helpers', () => {
    it('reports whether a Google connection exists', async () => {
      const state = createDbState();
      const env = makeEnv(state);

      await expect(hasGoogleConnection(env, USER_ID)).resolves.toBe(false);

      state.tokens.set(USER_ID, {
        encrypted_credentials: 'a',
        iv: 'iv',
        expires_at: new Date().toISOString(),
      });

      await expect(hasGoogleConnection(env, USER_ID)).resolves.toBe(true);
    });

    it('revokes a Google connection', async () => {
      const state = createDbState({
        tokens: new Map([
          [USER_ID, {
            encrypted_credentials: 'a',
            iv: 'iv',
            expires_at: new Date().toISOString(),
          }],
        ]),
      });
      const env = makeEnv(state);

      await revokeGoogleConnection(env, USER_ID);
      expect(state.tokens.has(USER_ID)).toBe(false);
    });
  });
});
