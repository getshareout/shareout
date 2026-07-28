// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleDataRequest } from '../../../src/data/router';
import * as jsonStore from '../../../src/data/json-store';
import * as pilot from '../../../src/data/agent/pilot';
import { createAccessToken } from '../../../src/token';
import { DATA_ERRORS } from '../../../src/types';
import type { Env } from '../../../src/types';
import { miniDbBinding } from '../helpers/minidb-mock';

const ARTIFACT_ID = 'art_router_test';
const BASE_URL = 'https://shareout.example.com';

function artifactEnv(overrides: Partial<Env> = {}): Env {
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn(() => ({
      first: vi.fn(async () => {
        if (sql.includes('FROM artifacts WHERE id')) {
          return {
            id: ARTIFACT_ID,
            name: 'Router Artifact',
            visibility: 'public',
            auth_method: null,
            workspace_id: 'ws_test',
          };
        }
        return null;
      }),
      all: vi.fn(async () => ({ results: [] })),
      run: vi.fn(async () => ({ meta: { changes: 0 } })),
    })),
  }));

  const env = {
    SESSION_SECRET: 'session-secret',
    SHAREOUT_BASE_URL: BASE_URL,
    DB: { prepare } as unknown as Env['DB'],
    ...overrides,
  } as Env;
  (env as { MINIDB: unknown }).MINIDB = miniDbBinding((() => env.DB) as () => never);
  return env;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('handleDataRequest routing', () => {
  it('returns invalid request when path is too short', async () => {
    const response = await handleDataRequest(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}`, { method: 'GET' }),
      artifactEnv(),
      ARTIFACT_ID,
    );
    expect(response.status).toBe(400);
  });

  it('handles CORS preflight with 204', async () => {
    const response = await handleDataRequest(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/json`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://app.example.com' },
      }),
      artifactEnv(),
      `${ARTIFACT_ID}/json`,
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example.com');
  });

  it('returns not found for unknown tiers', async () => {
    const response = await handleDataRequest(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/unknown`, { method: 'GET' }),
      artifactEnv(),
      `${ARTIFACT_ID}/unknown`,
    );
    expect(response.status).toBe(404);
  });

  it('routes json store reads', async () => {
    const env = artifactEnv();
    const response = await handleDataRequest(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/json`, { method: 'GET' }),
      env,
      `${ARTIFACT_ID}/json`,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { keys: [], count: 0 },
    });
  });

  it('routes platform provider listing', async () => {
    const response = await handleDataRequest(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/platform/providers`, { method: 'GET' }),
      artifactEnv({
        CREDENTIALS_KEY: 'test-credentials-key-32bytes!!',
        GOOGLE_CLIENT_ID: 'g',
        GOOGLE_CLIENT_SECRET: 's',
        SHOPIFY_CLIENT_ID: 's',
        SHOPIFY_CLIENT_SECRET: 's',
        TIENDANUBE_CLIENT_ID: 't',
        TIENDANUBE_CLIENT_SECRET: 't',
      }),
      `${ARTIFACT_ID}/platform/providers`,
    );
    expect(response.status).toBe(200);
    const body = await response.json() as { data: { providers: unknown[] } };
    expect(body.data.providers.length).toBeGreaterThanOrEqual(4);
  });

  it('rejects batch requests without a POST body', async () => {
    const response = await handleDataRequest(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/batch`, { method: 'GET' }),
      artifactEnv(),
      `${ARTIFACT_ID}/batch`,
    );
    expect(response.status).toBe(400);
  });

  it('rejects invalid batch payloads', async () => {
    const env = artifactEnv();
    const empty = await handleDataRequest(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requests: [] }),
      }),
      env,
      `${ARTIFACT_ID}/batch`,
    );
    expect(empty.status).toBe(400);

    const tooMany = await handleDataRequest(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: Array.from({ length: 21 }, (_, i) => ({ path: `/json/k${i}` })),
        }),
      }),
      env,
      `${ARTIFACT_ID}/batch`,
    );
    expect(tooMany.status).toBe(400);
  });

  it('does not leak internal error messages from batch sub-request failures', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(jsonStore, 'handleJsonStore').mockRejectedValue(new Error('D1_ERROR: no such table: secret_internal'));

    const response = await handleDataRequest(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{ path: '/json', method: 'GET' }],
        }),
      }),
      artifactEnv(),
      `${ARTIFACT_ID}/batch`,
    );

    expect(response.status).toBe(200);
    const body = await response.json() as {
      data: { results: Array<{ path: string; success: boolean; error?: string; code?: string }> };
    };
    expect(body.data.results[0]).toMatchObject({
      path: '/json',
      success: false,
      error: DATA_ERRORS.INTERNAL_ERROR.message,
      code: 'INTERNAL_ERROR',
    });
    expect(body.data.results[0].error).not.toContain('secret_internal');
    expect(consoleError).toHaveBeenCalled();
  });

  it('executes batch sub-requests for supported tiers', async () => {
    const response = await handleDataRequest(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [
            { path: '/json', method: 'GET' },
            { path: '/tables', method: 'GET' },
            { path: '/datasets', method: 'GET' },
            { path: '/blobs', method: 'GET' },
            { path: '/unknown-tier', method: 'GET' },
          ],
        }),
      }),
      artifactEnv(),
      `${ARTIFACT_ID}/batch`,
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { data: { results: Array<{ path: string; success: boolean; code?: string }> } };
    expect(body.data.results).toHaveLength(5);
    expect(body.data.results[0]?.success).toBe(true);
    expect(body.data.results[4]).toMatchObject({ success: false, code: 'NOT_FOUND' });
  });

  it('returns auth failure for private artifacts without credentials', async () => {
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => {
          if (sql.includes('FROM artifacts WHERE id')) {
            return {
              id: ARTIFACT_ID,
              name: 'Private',
              visibility: 'private',
              auth_method: 'password',
            };
          }
          return null;
        }),
        all: vi.fn(async () => ({ results: [] })),
        run: vi.fn(async () => ({ meta: { changes: 0 } })),
      })),
    }));
    const env = artifactEnv();
    (env as { DB: unknown }).DB = { prepare };

    const response = await handleDataRequest(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/json`, { method: 'GET' }),
      env,
      `${ARTIFACT_ID}/json`,
    );
    expect(response.status).toBe(401);
  });

  it('rejects batch requests with invalid JSON', async () => {
    const response = await handleDataRequest(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      }),
      artifactEnv(),
      `${ARTIFACT_ID}/batch`,
    );
    expect(response.status).toBe(400);
  });

  it('routes additional data tiers without throwing', async () => {
    const env = artifactEnv({
      CREDENTIALS_KEY: 'test-credentials-key-32bytes!!',
      GOOGLE_CLIENT_ID: 'g',
      GOOGLE_CLIENT_SECRET: 's',
      SHOPIFY_CLIENT_ID: 's',
      SHOPIFY_CLIENT_SECRET: 's',
      TIENDANUBE_CLIENT_ID: 't',
      TIENDANUBE_CLIENT_SECRET: 't',
    });
    const tiers: Array<{ path: string; method?: string }> = [
      { path: `${ARTIFACT_ID}/tables` },
      { path: `${ARTIFACT_ID}/datasets` },
      { path: `${ARTIFACT_ID}/datasets/_upload/ds_1`, method: 'POST' },
      { path: `${ARTIFACT_ID}/connections` },
      { path: `${ARTIFACT_ID}/secrets` },
      { path: `${ARTIFACT_ID}/realtime` },
      { path: `${ARTIFACT_ID}/comments` },
      { path: `${ARTIFACT_ID}/sheets` },
      { path: `${ARTIFACT_ID}/github` },
      { path: `${ARTIFACT_ID}/blobs` },
      { path: `${ARTIFACT_ID}/blobs/_upload/blob_1`, method: 'POST' },
      { path: `${ARTIFACT_ID}/agent` },
      { path: `${ARTIFACT_ID}/slides` },
      { path: `${ARTIFACT_ID}/proxy` },
      { path: `${ARTIFACT_ID}/proxy/config` },
      { path: `${ARTIFACT_ID}/email` },
      { path: `${ARTIFACT_ID}/platform/connections` },
    ];

    for (const tier of tiers) {
      const response = await handleDataRequest(
        new Request(`${BASE_URL}/v1/data/${tier.path}`, { method: tier.method || 'GET' }),
        env,
        tier.path,
      );
      expect(response.status).toBeGreaterThanOrEqual(200);
      expect(response.status).toBeLessThan(600);
    }
  });

  it('allows private artifact access with a valid bearer token', async () => {
    const prepare = vi.fn((sql: string) => ({
      bind: vi.fn(() => ({
        first: vi.fn(async () => {
          if (sql.includes('FROM artifacts WHERE id')) {
            return {
              id: ARTIFACT_ID,
              name: 'Private',
              visibility: 'private',
              auth_method: 'password',
            };
          }
          return null;
        }),
        all: vi.fn(async () => ({ results: [{ key: 'prefs' }] })),
        run: vi.fn(async () => ({ meta: { changes: 0 } })),
      })),
    }));
    const env = artifactEnv();
    (env as { DB: unknown }).DB = { prepare };
    const token = await createAccessToken(ARTIFACT_ID, 'password', env);

    const response = await handleDataRequest(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/json`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      }),
      env,
      `${ARTIFACT_ID}/json`,
    );
    expect(response.status).toBe(200);
  });
});

describe('pilot spike bypass is loopback-only (defense in depth)', () => {
  const SPIKE_PATH = 'spike/agent/pilot/chat/completions';

  it('does NOT reach the spike handler when only the Host header is spoofed to localhost', async () => {
    const spy = vi.spyOn(pilot, 'handlePilotSpike').mockResolvedValue(new Response('spike'));
    // Prod URL host, attacker-supplied Host: localhost. isLocalRequest() alone
    // would return true; the URL-hostname guard must still block dispatch.
    const response = await handleDataRequest(
      new Request(`${BASE_URL}/v1/data/${SPIKE_PATH}`, {
        method: 'POST',
        headers: { Host: 'localhost', 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
      }),
      artifactEnv(),
      SPIKE_PATH,
    );
    expect(spy).not.toHaveBeenCalled();
    // Falls through to normal artifact resolution rather than the bypass.
    expect(response.status).not.toBe(200);
  });

  it('reaches the spike handler only when the request URL hostname is loopback', async () => {
    const spy = vi.spyOn(pilot, 'handlePilotSpike').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    const response = await handleDataRequest(
      new Request(`http://localhost:55162/v1/data/${SPIKE_PATH}`, {
        method: 'POST',
        headers: { Host: 'localhost:55162', 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
      }),
      artifactEnv(),
      SPIKE_PATH,
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
  });
});

describe('test-run sandbox blocks mutations (Unit B)', () => {
  it('blocks any mutating method with 403 under an owner_test token', async () => {
    const env = artifactEnv();
    const token = await createAccessToken(ARTIFACT_ID, 'owner_test', env, 600, 'owner@example.com');

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await handleDataRequest(
        new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/json/key1`, {
          method,
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          ...(method === 'DELETE' ? {} : { body: '{"v":1}' }),
        }),
        env,
        `${ARTIFACT_ID}/json/key1`,
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: expect.stringContaining('read-only test run') });
    }
  });

  it('still allows reads (GET) under an owner_test token', async () => {
    const env = artifactEnv();
    const token = await createAccessToken(ARTIFACT_ID, 'owner_test', env, 600, 'owner@example.com');
    const response = await handleDataRequest(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/json`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      }),
      env,
      `${ARTIFACT_ID}/json`,
    );
    expect(response.status).not.toBe(403);
  });
});
