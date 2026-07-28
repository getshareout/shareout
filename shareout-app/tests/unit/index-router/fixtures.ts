// @vitest-environment node
/**
 * Shared request helpers and env factories for index router integration tests.
 * @module tests/unit/index-router/fixtures
 */
import type { Env } from '../../../src/types';
import { vi } from 'vitest';
import worker from '../../../src/index';

const APEX = 'https://shareout.example.com';
const SUB = 'https://acme.shareout.example.com';

type DbResolver = (sql: string, args?: unknown[]) => unknown;

function createDb(resolver: DbResolver = () => null) {
  // The instance is past first-run setup unless a test says otherwise, so routing
  // tests don't all redirect to /setup.
  const withSetupDone: DbResolver = (sql, args) => {
    const r = resolver(sql, args);
    if (r == null && sql.includes('COUNT(*) AS n') && sql.includes('FROM users')) return { n: 1 };
    return r;
  };
  const statement = (sql: string, args: unknown[] = []) => ({
    first: vi.fn(async () => withSetupDone(sql, args)),
    all: vi.fn(async () => {
      const value = withSetupDone(sql, args);
      return { results: Array.isArray(value) ? value : [] };
    }),
    run: vi.fn(async () => ({ success: true })),
  });
  return {
    // Statements are usable with or without .bind() — needsSetup() calls .first() directly.
    prepare: vi.fn((sql: string) => ({
      ...statement(sql),
      bind: vi.fn((...args: unknown[]) => statement(sql, args)),
    })),
  };
}

function createEnv(dbResolver?: DbResolver, extras: Partial<Env> = {}): Env {
  return {
    DB: createDb(dbResolver),
    SHAREOUT_BASE_URL: APEX,
    GOOGLE_CLIENT_ID: 'google-client',
    GOOGLE_CLIENT_SECRET: 'google-secret',
    SESSION_SECRET: 'session-secret',
    SHOPIFY_CLIENT_ID: 'shopify-id',
    SHOPIFY_CLIENT_SECRET: 'shopify-secret',
    TIENDANUBE_CLIENT_ID: 'tn-id',
    TIENDANUBE_CLIENT_SECRET: 'tn-secret',
    GITHUB_CLIENT_ID: 'github-id',
    GITHUB_CLIENT_SECRET: 'github-secret',
    ...extras,
  } as Env;
}

async function fetchPath(
  path: string,
  init?: RequestInit,
  host = APEX,
  env = createEnv(),
): Promise<Response> {
  return worker.fetch(new Request(`${host}${path}`, init), env);
}

function authed(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  headers.set('Authorization', 'Bearer valid-token');
  return { ...init, headers };
}

async function handlerTag(response: Response): Promise<string> {
  const header = response.headers.get('X-Mock-Handler');
  if (header) return header;
  const body = await response.text();
  try {
    const parsed = JSON.parse(body) as { handler?: string };
    return parsed.handler ?? body.slice(0, 40);
  } catch {
    return body.slice(0, 40);
  }
}

function sheetsState(artifactId = 'art_1'): string {
  return btoa(JSON.stringify({ shareoutSheetsAuth: true, artifactId }));
}

function githubState(artifactId = 'art_1'): string {
  return btoa(JSON.stringify({ shareoutGitHubAuth: true, artifactId }));
}

export {
  APEX,
  SUB,
  createDb,
  createEnv,
  fetchPath,
  authed,
  handlerTag,
  sheetsState,
  githubState,
};
