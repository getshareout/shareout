// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { snowflakeProvider } from '../../../../src/data/platform/providers/snowflake';
import { getSnowflakeJwt } from '../../../../src/data/platform/providers/snowflake/jwt';
import { hasProvider } from '../../../../src/data/platform/registry';
import type { ExecutionContext } from '../../../../src/data/platform/types';
import { ARTIFACT_ID, publicArtifactEnv } from './helpers';

let privateKeyPem: string;

async function exportPkcs8Pem(key: CryptoKey): Promise<string> {
  const der = await crypto.subtle.exportKey('pkcs8', key);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  const lines = b64.match(/.{1,64}/g)?.join('\n') ?? b64;
  return `-----BEGIN PRIVATE KEY-----\n${lines}\n-----END PRIVATE KEY-----`;
}

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  privateKeyPem = await exportPkcs8Pem(pair.privateKey);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function execCtx(configOverrides: Record<string, unknown> = {}): ExecutionContext {
  return {
    artifactId: ARTIFACT_ID,
    connectionId: 'conn_sf',
    connectionConfig: {
      id: 'conn_sf',
      name: 'Acme Snowflake',
      provider: 'snowflake',
      preferredMode: 'proxy',
      config: {
        account: 'xy12345',
        user: 'svc_analytics',
        role: 'ANALYST',
        warehouse: 'ANALYTICS_WH',
        database: 'ANALYTICS_WH',
        schema: 'CUSTOMER_METRICS',
        publicKeyFingerprint: 'SHA256:abc123def456',
        ...configOverrides,
      },
      createdAt: '',
      updatedAt: '',
    },
    credentials: { access_token: '', extra: { private_key: privateKeyPem } },
    env: publicArtifactEnv(),
  };
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const part = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(part));
}

describe('Snowflake provider', () => {
  it('is registered and proxy-only', () => {
    expect(hasProvider('snowflake')).toBe(true);
    expect(snowflakeProvider.config.id).toBe('snowflake');
    expect(snowflakeProvider.supportsDirectMode()).toBe(false);
    expect(snowflakeProvider.requiresProxy()).toBe(true);
    expect(snowflakeProvider.listEndpoints().map((e) => e.id)).toContain('statements.execute');
  });

  it('mints a key-pair JWT with the qualified iss/sub', async () => {
    const jwt = await getSnowflakeJwt({
      account: 'xy12345',
      user: 'svc_analytics',
      publicKeyFingerprint: 'SHA256:abc123def456',
      privateKey: privateKeyPem,
    });
    expect(jwt.split('.')).toHaveLength(3);
    const payload = decodeJwtPayload(jwt);
    expect(payload.iss).toBe('XY12345.SVC_ANALYTICS.SHA256:abc123def456');
    expect(payload.sub).toBe('XY12345.SVC_ANALYTICS');
    expect(typeof payload.exp).toBe('number');
  });

  it('executes a statement against the SQL API with key-pair auth', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({
        resultSetMetaData: { numRows: 1, rowType: [{ name: 'N' }] },
        data: [['42']],
      }), { status: 200 });
    }));

    const result = await snowflakeProvider.executeRequest(
      execCtx(),
      snowflakeProvider.getEndpoint('statements.execute')!,
      { body: { statement: 'SELECT 42 AS N' } },
    );

    expect(result.success).toBe(true);
    expect((result.data as { data: unknown[] }).data).toEqual([['42']]);

    const call = calls[0];
    expect(call.url).toBe('https://xy12345.snowflakecomputing.com/api/v2/statements');
    const headers = call.init.headers as Record<string, string>;
    expect(headers.Authorization).toMatch(/^Bearer /);
    expect(headers['X-Snowflake-Authorization-Token-Type']).toBe('KEYPAIR_JWT');
    expect(headers['User-Agent']).toBeTruthy();
    const body = JSON.parse(call.init.body as string);
    expect(body).toMatchObject({
      statement: 'SELECT 42 AS N',
      database: 'ANALYTICS_WH',
      schema: 'CUSTOMER_METRICS',
      warehouse: 'ANALYTICS_WH',
      role: 'ANALYST',
    });
  });

  it('returns a clear error when required config is missing', async () => {
    const ctx = execCtx({ publicKeyFingerprint: undefined });
    const result = await snowflakeProvider.executeRequest(
      ctx,
      snowflakeProvider.getEndpoint('statements.execute')!,
      { body: { statement: 'SELECT 1' } },
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('MISSING_SNOWFLAKE_CONFIG');
    expect(result.error?.message).toContain('publicKeyFingerprint');
  });

  it('requires a SQL statement', async () => {
    const result = await snowflakeProvider.executeRequest(
      execCtx(),
      snowflakeProvider.getEndpoint('statements.execute')!,
      {},
    );
    expect(result.error?.code).toBe('MISSING_STATEMENT');
  });

  it('surfaces Snowflake API errors without leaking upstream bodies', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      code: '002003',
      message: 'SQL compilation error: Object NOPE does not exist',
      sqlState: '42S02',
    }), { status: 422 })));

    const result = await snowflakeProvider.executeRequest(
      execCtx(),
      snowflakeProvider.getEndpoint('statements.execute')!,
      { body: { statement: 'SELECT * FROM nope' } },
    );
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('SNOWFLAKE_ERROR_422');
    expect(result.error?.message).toBe('Provider request failed (HTTP 422)');
    expect(result.error?.message).not.toContain('SQL compilation error');
    expect(consoleError).toHaveBeenCalled();
  });

  it('honours a host override and supports raw-string statements', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo) => {
      seen.push(String(url));
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    }));

    await snowflakeProvider.executeRequest(
      execCtx({ host: 'https://myorg-myacct.privatelink.snowflakecomputing.com' }),
      snowflakeProvider.getEndpoint('statements.execute')!,
      { body: 'SELECT CURRENT_VERSION()' },
    );
    expect(seen[0]).toBe('https://myorg-myacct.privatelink.snowflakecomputing.com/api/v2/statements');
  });

  it('rejects unsupported OAuth/direct flows', async () => {
    await expect(snowflakeProvider.getAuthUrl()).rejects.toThrow('key-pair');
    await expect(snowflakeProvider.prepareDirectCredentials()).rejects.toThrow('direct');
  });
});
