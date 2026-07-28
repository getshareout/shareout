/**
 * Request builders and env fixtures for connections handler unit tests.
 *
 * @module tests/unit/data/connections/shared
 */
import { vi } from 'vitest';
import { encryptCredentials } from '../../../../src/data/connections/credentials';
import type { DataContext } from '../../../../src/data/middleware';
import type { Env } from '../../../../src/types';
import type { ConnectionsDbBundle } from './mock-db';

export const ARTIFACT_ID = 'art_test';
export const BASE_URL = 'https://shareout.example.com';
export const CREDENTIALS_KEY = 'test-credentials-key-32chars!!';

/** Match connection_cache query_hash generation in src/data/connections/cache.ts. */
export async function hashConnectionQuery(
  query: string | Record<string, unknown>,
  params?: Record<string, unknown>,
): Promise<string> {
  const { sha256 } = await import('../../../../src/crypto-utils');
  const normalized = JSON.stringify({ query, params: params ?? null });
  return sha256(new TextEncoder().encode(normalized).buffer as ArrayBuffer);
}

export function makeEnv(
  dbBundle: ConnectionsDbBundle,
  options: {
    credentialsKey?: string;
    cacheGetResult?: unknown;
  } = {},
): Env {
  const credentialsKey = 'credentialsKey' in options
    ? options.credentialsKey
    : CREDENTIALS_KEY;
  return {
    DB: dbBundle.DB,
    CREDENTIALS_KEY: credentialsKey,
    ARTIFACTS: {
      get: vi.fn(async () =>
        options.cacheGetResult !== undefined
          ? ({ json: async () => options.cacheGetResult } as R2ObjectBody)
          : null,
      ),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
    } as unknown as Env['ARTIFACTS'],
  } as Env;
}

export function makeCtx(env: Env): DataContext {
  return {
    artifactId: ARTIFACT_ID,
    artifact: {
      id: ARTIFACT_ID,
      name: 'Test Artifact',
      visibility: 'public',
      auth_method: null,
    },
    env,
    origin: 'https://app.example.com',
  };
}

export function connRequest(
  method: string,
  pathSuffix: string,
  body?: unknown,
  init: RequestInit = {},
): Request {
  const headers = new Headers(init.headers ?? {});
  if (body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/connections/${pathSuffix}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...init,
  });
}

export async function encryptedApiKey(apiKey: string) {
  return encryptCredentials({ apiKey }, CREDENTIALS_KEY);
}
