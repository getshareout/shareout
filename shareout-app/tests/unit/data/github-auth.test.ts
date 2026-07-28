// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encryptCredentials } from '../../../src/data/connections/credentials';
import {
  exchangeCodeForToken,
  getArtifactToken,
  getArtifactTokenStatus,
  getGitHubAuthUrl,
  getGitHubUser,
  removeArtifactToken,
  storeArtifactToken,
} from '../../../src/data/github/github-auth';
import type { Env } from '../../../src/types';

const BASE_URL = 'https://shareout.example.com';
const CREDENTIALS_KEY = 'test-credentials-key-32-chars!!';
const ARTIFACT_ID = 'art_github_test';

// The GitHub grant is a `connections` row: token blob + the GitHub identity in config.
interface GitHubTokenRow {
  encrypted_credentials: string;
  iv: string;
  config: string;
}

interface DbState {
  tokens: Map<string, GitHubTokenRow>;
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
          if (sql.includes('SELECT config FROM connections')) {
            const row = state.tokens.get(args[0] as string);
            return row ? { config: row.config } : null;
          }
          if (sql.includes('FROM connections')) {
            return state.tokens.get(args[0] as string) ?? null;
          }
          return null;
        }),
        run: vi.fn(async () => {
          if (sql.includes('INSERT INTO connections')) {
            // (id, scope_id, name, config, encrypted_credentials, iv, created, updated)
            const [, artifactId, , config, encrypted, iv] = args as string[];
            state.tokens.set(artifactId, { encrypted_credentials: encrypted, iv, config });
          }
          if (sql.includes('DELETE FROM connections')) {
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
    GITHUB_CLIENT_ID: 'gh-client-id',
    GITHUB_CLIENT_SECRET: 'gh-client-secret',
    CREDENTIALS_KEY,
    ...extras,
  } as Env;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('github-auth', () => {
  describe('getGitHubAuthUrl', () => {
    it('builds the OAuth authorize URL', () => {
      const env = makeEnv(createDbState());
      const url = getGitHubAuthUrl(env, '/data/github/callback', 'state-123');

      expect(url).toContain('https://github.com/login/oauth/authorize?');
      expect(url).toContain('client_id=gh-client-id');
      expect(url).toContain(encodeURIComponent(`${BASE_URL}/data/github/callback`));
      expect(url).toContain('scope=repo');
      expect(url).toContain('state=state-123');
    });
  });

  describe('exchangeCodeForToken', () => {
    it('exchanges an authorization code for a token', async () => {
      vi.stubGlobal('fetch', vi.fn(async (url, init) => {
        expect(String(url)).toBe('https://github.com/login/oauth/access_token');
        expect(init?.method).toBe('POST');
        const body = JSON.parse(String(init?.body));
        expect(body).toEqual({
          client_id: 'gh-client-id',
          client_secret: 'gh-client-secret',
          code: 'auth-code',
        });
        return new Response(JSON.stringify({
          access_token: 'gho_access',
          token_type: 'bearer',
          scope: 'repo',
        }), { status: 200 });
      }));

      const env = makeEnv(createDbState());
      await expect(exchangeCodeForToken('auth-code', env)).resolves.toEqual({
        access_token: 'gho_access',
        token_type: 'bearer',
        scope: 'repo',
      });
    });

    it('defaults token_type and scope when omitted', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
        access_token: 'gho_access',
      }), { status: 200 })));

      const env = makeEnv(createDbState());
      await expect(exchangeCodeForToken('code', env)).resolves.toEqual({
        access_token: 'gho_access',
        token_type: 'bearer',
        scope: '',
      });
    });

    it('throws when token exchange HTTP fails', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('bad request', { status: 400 })));

      const env = makeEnv(createDbState());
      await expect(exchangeCodeForToken('bad', env)).rejects.toThrow('GitHub token exchange failed: bad request');
    });

    it('throws when GitHub returns an OAuth error', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
        error: 'bad_verification_code',
        error_description: 'The code passed is incorrect or expired.',
      }), { status: 200 })));

      const env = makeEnv(createDbState());
      await expect(exchangeCodeForToken('expired', env)).rejects.toThrow('The code passed is incorrect or expired.');
    });

    it('throws with error code when description is missing', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
        error: 'bad_verification_code',
      }), { status: 200 })));

      const env = makeEnv(createDbState());
      await expect(exchangeCodeForToken('expired', env)).rejects.toThrow('bad_verification_code');
    });

    it('throws when no access token is returned', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })));

      const env = makeEnv(createDbState());
      await expect(exchangeCodeForToken('empty', env)).rejects.toThrow('No access token received from GitHub');
    });
  });

  describe('getGitHubUser', () => {
    it('returns the authenticated user', async () => {
      vi.stubGlobal('fetch', vi.fn(async (url, init) => {
        expect(String(url)).toBe('https://api.github.com/user');
        expect(init?.headers).toMatchObject({
          Authorization: 'Bearer gho_token',
          Accept: 'application/vnd.github+json',
        });
        return new Response(JSON.stringify({ login: 'octocat', id: 1, name: 'Octo Cat' }), { status: 200 });
      }));

      await expect(getGitHubUser('gho_token')).resolves.toEqual({
        login: 'octocat',
        id: 1,
        name: 'Octo Cat',
      });
    });

    it('throws when user lookup fails', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('Unauthorized', { status: 401 })));

      await expect(getGitHubUser('bad')).rejects.toThrow('Failed to get GitHub user: Unauthorized');
    });
  });

  describe('artifact token storage', () => {
    it('stores encrypted artifact tokens', async () => {
      const state = createDbState();
      const env = makeEnv(state);

      await storeArtifactToken(env, ARTIFACT_ID, 'gho_secret', { login: 'octocat', id: 42 });

      expect(state.tokens.has(ARTIFACT_ID)).toBe(true);
      expect(JSON.parse(state.tokens.get(ARTIFACT_ID)!.config)).toEqual({
        github_username: 'octocat',
        github_user_id: 42,
      });
    });

    it('throws when CREDENTIALS_KEY is missing', async () => {
      const env = makeEnv(createDbState(), { CREDENTIALS_KEY: undefined });

      await expect(
        storeArtifactToken(env, ARTIFACT_ID, 'gho_secret', { login: 'octocat', id: 1 }),
      ).rejects.toThrow('CREDENTIALS_KEY not configured');
    });

    it('returns null when credentials key is missing', async () => {
      const env = makeEnv(createDbState(), { CREDENTIALS_KEY: undefined });
      await expect(getArtifactToken(env, ARTIFACT_ID)).resolves.toBeNull();
    });

    it('returns null when no token is stored', async () => {
      const env = makeEnv(createDbState());
      await expect(getArtifactToken(env, ARTIFACT_ID)).resolves.toBeNull();
    });

    it('decrypts stored artifact tokens', async () => {
      const { encrypted, iv } = await encryptCredentials({ token: 'gho_saved' }, CREDENTIALS_KEY);
      const state = createDbState({
        tokens: new Map([
          [ARTIFACT_ID, {
            encrypted_credentials: encrypted,
            iv,
            config: JSON.stringify({ github_username: 'octocat', github_user_id: 7 }),
          }],
        ]),
      });
      const env = makeEnv(state);

      await expect(getArtifactToken(env, ARTIFACT_ID)).resolves.toEqual({
        token: 'gho_saved',
        username: 'octocat',
        userId: 7,
      });
    });

    it('returns connection status with username', async () => {
      const state = createDbState({
        tokens: new Map([
          [ARTIFACT_ID, {
            encrypted_credentials: 'enc',
            iv: 'iv',
            config: JSON.stringify({ github_username: 'octocat', github_user_id: 1 }),
          }],
        ]),
      });
      const env = makeEnv(state);

      await expect(getArtifactTokenStatus(env, ARTIFACT_ID)).resolves.toEqual({
        connected: true,
        username: 'octocat',
      });
      await expect(getArtifactTokenStatus(env, 'missing')).resolves.toEqual({ connected: false });
    });

    it('removes stored artifact tokens', async () => {
      const state = createDbState({
        tokens: new Map([
          [ARTIFACT_ID, {
            encrypted_credentials: 'enc',
            iv: 'iv',
            config: JSON.stringify({ github_username: 'octocat', github_user_id: 1 }),
          }],
        ]),
      });
      const env = makeEnv(state);

      await removeArtifactToken(env, ARTIFACT_ID);
      expect(state.tokens.has(ARTIFACT_ID)).toBe(false);
    });
  });
});
