// @vitest-environment node
import { vi } from 'vitest';
import { encryptCredentials } from '../../../../src/data/connections/credentials';
import type { DataContext } from '../../../../src/data/middleware';
import type { Env } from '../../../../src/types';
import type { DecryptedCredentials } from '../../../../src/data/platform/types';

export const ARTIFACT_ID = 'art_platform_test';
export const BASE_URL = 'https://shareout.example.com';
export const CREDENTIALS_KEY = 'test-credentials-key-32bytes!!';

export interface PlatformConnectionRow {
  id: string;
  artifact_id: string;
  name: string;
  provider: string;
  config: string;
  encrypted_credentials: string;
  iv: string;
  preferred_mode: string;
  created_at: string;
  updated_at: string;
}

export async function encryptTestCredentials(
  credentials: DecryptedCredentials,
  secretKey = CREDENTIALS_KEY,
): Promise<{ encrypted: string; iv: string }> {
  return encryptCredentials(
    {
      access_token: credentials.access_token,
      refresh_token: credentials.refresh_token,
      expires_at: credentials.expires_at,
      extra: credentials.extra,
    },
    secretKey,
  );
}

export function mockPlatformDb(handlers: {
  first?: (sql: string, bindings: unknown[]) => unknown;
  all?: (sql: string, bindings: unknown[]) => { results: unknown[] };
  run?: (sql: string, bindings: unknown[]) => { meta: { changes?: number } };
} = {}) {
  return vi.fn((sql: string) => ({
    bind: (...bindings: unknown[]) => ({
      first: vi.fn(async () => handlers.first?.(sql, bindings) ?? null),
      all: vi.fn(async () => handlers.all?.(sql, bindings) ?? { results: [] }),
      run: vi.fn(async () => handlers.run?.(sql, bindings) ?? { meta: { changes: 1 } }),
    }),
  }));
}

export function publicArtifactEnv(
  extras: Partial<Env> = {},
  dbHandlers?: Parameters<typeof mockPlatformDb>[0],
): Env {
  const platformPrepare = mockPlatformDb(dbHandlers);
  const prepare = vi.fn((sql: string) => {
    if (sql.includes('FROM artifacts WHERE id')) {
      return {
        bind: vi.fn(() => ({
          first: vi.fn(async () => ({
            id: ARTIFACT_ID,
            name: 'Platform Test Artifact',
            visibility: 'public',
            auth_method: null,
          })),
        })),
      };
    }
    if (sql.includes("scope_type = 'artifact'") || sql.includes('artifact_json')) {
      return platformPrepare(sql);
    }
    return platformPrepare(sql);
  });

  return {
    SESSION_SECRET: 'session-secret',
    SHAREOUT_BASE_URL: BASE_URL,
    CREDENTIALS_KEY,
    GOOGLE_CLIENT_ID: 'google-client-id',
    GOOGLE_CLIENT_SECRET: 'google-client-secret',
    SHOPIFY_CLIENT_ID: 'shopify-client-id',
    SHOPIFY_CLIENT_SECRET: 'shopify-client-secret',
    TIENDANUBE_CLIENT_ID: 'tn-client-id',
    TIENDANUBE_CLIENT_SECRET: 'tn-client-secret',
    DB: { prepare } as unknown as Env['DB'],
    ARTIFACTS: {
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    } as unknown as Env['ARTIFACTS'],
    ...extras,
  } as Env;
}

export function makeDataContext(env: Env, origin: string | null = 'https://app.example.com'): DataContext {
  return {
    artifactId: ARTIFACT_ID,
    artifact: {
      id: ARTIFACT_ID,
      name: 'Platform Test Artifact',
      visibility: 'public',
      auth_method: null,
    },
    env,
    origin,
  };
}

export async function parseJson<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}
