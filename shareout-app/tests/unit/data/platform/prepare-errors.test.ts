// Platform prepare endpoint error handling — no D1/crypto/token-exchange leaks.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handlePlatformRequest } from '../../../../src/data/platform';
import * as engineModule from '../../../../src/data/platform/core/engine';
import {
  ARTIFACT_ID,
  BASE_URL,
  encryptTestCredentials,
  makeDataContext,
  parseJson,
  publicArtifactEnv,
} from './helpers';
import * as middleware from '../../../../src/data/middleware';

const logError = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/logging', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/logging')>();
  return { ...actual, logError };
});

afterEach(() => {
  vi.restoreAllMocks();
  logError.mockReset();
});

describe('platform prepare error handling', () => {
  it('returns generic PREPARE_ERROR without leaking D1 internals', async () => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(true);
    vi.spyOn(engineModule.PlatformEngine.prototype, 'prepareForDirectMode').mockRejectedValue(
      new Error('D1_ERROR: no such table: connections'),
    );

    const res = await handlePlatformRequest(
      new Request(`${BASE_URL}/google-sheets/prepare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: 'conn_1', endpoint: 'values.get' }),
      }),
      makeDataContext(publicArtifactEnv()),
      ['google-sheets', 'prepare'],
    );

    expect(res.status).toBe(500);
    const body = await parseJson<{ code: string; error: string }>(res);
    expect(body.code).toBe('PREPARE_ERROR');
    expect(body.error).toBe('Failed to prepare credentials');
    expect(body.error).not.toMatch(/D1_ERROR/);
    expect(logError).toHaveBeenCalled();
  });

  it('returns generic PREPARE_ERROR without leaking token exchange bodies', async () => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(true);
    vi.spyOn(engineModule.PlatformEngine.prototype, 'prepareForDirectMode').mockRejectedValue(
      new Error('Authorized-user token refresh failed: {"error":"invalid_grant","error_description":"Bad Request"}'),
    );

    const res = await handlePlatformRequest(
      new Request(`${BASE_URL}/google-sheets/prepare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: 'conn_1', endpoint: 'values.get' }),
      }),
      makeDataContext(publicArtifactEnv()),
      ['google-sheets', 'prepare'],
    );

    expect(res.status).toBe(500);
    const body = await parseJson<{ error: string }>(res);
    expect(body.error).toBe('Failed to prepare credentials');
    expect(body.error).not.toMatch(/invalid_grant/);
    expect(logError).toHaveBeenCalled();
  });

  it('preserves safe connection-not-found message with 404', async () => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(true);
    vi.spyOn(engineModule.PlatformEngine.prototype, 'prepareForDirectMode').mockRejectedValue(
      new Error('Connection not found'),
    );

    const res = await handlePlatformRequest(
      new Request(`${BASE_URL}/google-sheets/prepare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: 'missing', endpoint: 'values.get' }),
      }),
      makeDataContext(publicArtifactEnv()),
      ['google-sheets', 'prepare'],
    );

    expect(res.status).toBe(404);
    const body = await parseJson<{ code: string; error: string }>(res);
    expect(body.code).toBe('CONNECTION_NOT_FOUND');
    expect(body.error).toBe('Connection not found');
  });

  it('preserves safe direct-mode provider message with 400', async () => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(true);
    vi.spyOn(engineModule.PlatformEngine.prototype, 'prepareForDirectMode').mockRejectedValue(
      new Error('Shopify does not support direct mode due to CORS restrictions'),
    );

    const res = await handlePlatformRequest(
      new Request(`${BASE_URL}/shopify/prepare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: 'conn_1', endpoint: 'products.list' }),
      }),
      makeDataContext(publicArtifactEnv()),
      ['shopify', 'prepare'],
    );

    expect(res.status).toBe(400);
    const body = await parseJson<{ error: string }>(res);
    expect(body.error).toContain('does not support direct mode');
  });

  it('still prepares direct mode credentials on success', async () => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(true);
    const { encrypted, iv } = await encryptTestCredentials({ access_token: 'tok', expires_at: Date.now() + 3_600_000 });
    const env = publicArtifactEnv({}, {
      first: () => ({
        id: 'conn_1',
        scope_type: 'artifact',
    scope_id: ARTIFACT_ID,
        name: 'c',
        provider: 'google-sheets',
        config: '{}',
        encrypted_credentials: encrypted,
        iv,
        preferred_mode: 'auto',
        created_at: '',
        updated_at: '',
      }),
    });

    const res = await handlePlatformRequest(
      new Request(`${BASE_URL}/google-sheets/prepare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: 'conn_1', endpoint: 'values.get' }),
      }),
      makeDataContext(env),
      ['google-sheets', 'prepare'],
    );

    expect((await parseJson(res)).data.mode).toBe('direct');
  });
});
