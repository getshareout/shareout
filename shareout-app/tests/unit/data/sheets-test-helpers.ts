/**
 * Request builders and fetch stubs shared by sheets handler unit tests.
 */
import { vi } from 'vitest';
import { encryptCredentials } from '../../../src/data/connections/credentials';
import type { DataContext } from '../../../src/data/middleware';
import type { Env } from '../../../src/types';
import { createAccessToken } from '../../../src/token';
import {
  SHEETS_TEST_ARTIFACT_ID,
  SHEETS_TEST_BASE_URL,
  SHEETS_TEST_CREDENTIALS_KEY,
  SHEETS_TEST_SPREADSHEET_ID,
  type SheetsDbState,
} from './sheets-mock-db';

export {
  SHEETS_TEST_ARTIFACT_ID as ARTIFACT_ID,
  SHEETS_TEST_BASE_URL as BASE_URL,
  SHEETS_TEST_CREDENTIALS_KEY as CREDENTIALS_KEY,
  SHEETS_TEST_SPREADSHEET_ID as SPREADSHEET_ID,
};

export const SHEETS_TEST_USER_ID = 'usr_test';

export function makeSheetsCtx(env: Env): DataContext {
  return {
    artifactId: SHEETS_TEST_ARTIFACT_ID,
    artifact: {
      id: SHEETS_TEST_ARTIFACT_ID,
      name: 'Test Artifact',
      visibility: 'public',
      auth_method: null,
      owner_id: 'usr_owner',
    },
    env,
    db: (env as unknown as { DB: unknown }).DB,
    origin: 'https://app.example.com',
  } as unknown as DataContext;
}

export async function ownerAuthHeaders(env: Env): Promise<HeadersInit> {
  const token = await createAccessToken(SHEETS_TEST_ARTIFACT_ID, 'owner', env);
  return { Authorization: `Bearer ${token}` };
}

export function sheetsRequest(
  path: string,
  init: RequestInit = {},
  query = '',
): Request {
  const headers = new Headers(init.headers ?? {});
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return new Request(
    `${SHEETS_TEST_BASE_URL}/v1/data/${SHEETS_TEST_ARTIFACT_ID}/sheets/${path}${query}`,
    { ...init, headers },
  );
}

export async function storeArtifactToken(
  state: SheetsDbState,
  _env: Env,
  options: {
    accessToken?: string;
    refreshToken?: string;
    expiresInMs?: number;
  } = {},
) {
  const accessToken = options.accessToken ?? 'valid-access-token';
  const refreshToken = options.refreshToken ?? 'valid-refresh-token';
  const expiresInMs = options.expiresInMs ?? 60 * 60 * 1000;
  const { encrypted, iv } = await encryptCredentials(
    {
      access_token: accessToken,
      refresh_token: refreshToken,
    },
    SHEETS_TEST_CREDENTIALS_KEY,
  );
  state.artifactTokens.set(SHEETS_TEST_ARTIFACT_ID, {
    artifact_id: SHEETS_TEST_ARTIFACT_ID,
    encrypted_credentials: encrypted,
    iv,
    expires_at: new Date(Date.now() + expiresInMs).toISOString(),
  });
}

/** Route `fetch` by URL substring to canned responses for Google Sheets API calls. */
export function mockFetchRouter(
  handlers: Record<string, (init?: RequestInit) => Partial<Response>>,
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      for (const [pattern, handler] of Object.entries(handlers)) {
        if (url.includes(pattern)) {
          const result = handler(init);
          return {
            ok: result.ok ?? true,
            status: result.status ?? (result.ok === false ? 500 : 200),
            json: async () => result.json?.() ?? result,
            text: async () => result.text ?? JSON.stringify(result),
          };
        }
      }
      return {
        ok: false,
        status: 404,
        json: async () => ({}),
        text: async () => 'not found',
      };
    }),
  );
}
