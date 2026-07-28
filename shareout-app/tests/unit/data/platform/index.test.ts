// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  handlePlatformRequest,
  hasProvider,
  listProviders,
} from '../../../../src/data/platform/index';
import {
  ARTIFACT_ID,
  BASE_URL,
  encryptTestCredentials,
  makeDataContext,
  mockPlatformDb,
  parseJson,
  publicArtifactEnv,
} from './helpers';
import * as middleware from '../../../../src/data/middleware';

// Connection mutations are owner-gated; authenticate as owner for lifecycle tests.
function asOwner() {
  return vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(true);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('handlePlatformRequest', () => {
  it('lists registered providers', async () => {
    expect(hasProvider('google-sheets')).toBe(true);
    expect(listProviders().map((p) => p.id)).toEqual(
      expect.arrayContaining(['google-sheets', 'google-analytics', 'shopify', 'tiendanube']),
    );

    const response = await handlePlatformRequest(
      new Request(`${BASE_URL}/providers`, { method: 'GET' }),
      makeDataContext(publicArtifactEnv()),
      ['providers'],
    );

    expect(response.status).toBe(200);
    const body = await parseJson<{ success: boolean; data: { providers: { id: string }[] } }>(response);
    expect(body.data.providers.length).toBeGreaterThanOrEqual(4);
  });

  it('rejects unsupported methods on provider root', async () => {
    const response = await handlePlatformRequest(
      new Request(`${BASE_URL}/google-sheets`, { method: 'POST' }),
      makeDataContext(publicArtifactEnv()),
      ['google-sheets'],
    );

    expect(response.status).toBe(405);
  });

  it('returns provider config and endpoints', async () => {
    const response = await handlePlatformRequest(
      new Request(`${BASE_URL}/google-sheets`, { method: 'GET' }),
      makeDataContext(publicArtifactEnv()),
      ['google-sheets'],
    );

    const body = await parseJson<{ data: { config: { id: string }; endpoints: unknown[] } }>(response);
    expect(body.data.config.id).toBe('google-sheets');
    expect(body.data.endpoints.length).toBeGreaterThan(0);
  });

  it('returns provider not found with hints', async () => {
    const response = await handlePlatformRequest(
      new Request(`${BASE_URL}/unknown`, { method: 'GET' }),
      makeDataContext(publicArtifactEnv()),
      ['unknown-provider'],
    );

    expect(response.status).toBe(404);
    const body = await parseJson<{ hint?: string }>(response);
    expect(body.hint).toContain('google-sheets');
  });

  it('blocks connection writes from non-owners', async () => {
    const ctx = makeDataContext(publicArtifactEnv());
    const res = await handlePlatformRequest(
      new Request(`${BASE_URL}/connections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'x', provider: 'google-sheets', credentials: { access_token: 't' } }),
      }),
      ctx,
      ['connections'],
    );
    expect(res.status).toBe(403);
  });

  it('manages connections lifecycle', async () => {
    asOwner();
    const { encrypted, iv } = await encryptTestCredentials({ access_token: 'tok' });
    const row = {
      id: 'conn_1',
      scope_type: 'artifact',
    scope_id: ARTIFACT_ID,
      name: 'Sheets Conn',
      provider: 'google-sheets',
      config: '{}',
      encrypted_credentials: encrypted,
      iv,
      preferred_mode: 'auto',
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    };

    const env = publicArtifactEnv({}, {
      all: () => ({ results: [row] }),
      first: (sql, bindings) => {
        if (sql.includes('AND name = ?') && bindings[1] === 'Sheets Conn') {
          return row;
        }
        return null;
      },
      run: () => ({ meta: { changes: 1 } }),
    });

    const ctx = makeDataContext(env);

    const list = await handlePlatformRequest(
      new Request(`${BASE_URL}/connections`, { method: 'GET' }),
      ctx,
      ['connections'],
    );
    expect((await parseJson(list)).data.connections).toHaveLength(1);

    const create = await handlePlatformRequest(
      new Request(`${BASE_URL}/connections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'New',
          provider: 'google-sheets',
          credentials: { access_token: 'new-tok' },
        }),
      }),
      ctx,
      ['connections'],
    );
    expect(create.status).toBe(201);

    const get = await handlePlatformRequest(
      new Request(`${BASE_URL}/connections/Sheets%20Conn`, { method: 'GET' }),
      ctx,
      ['connections', 'Sheets Conn'],
    );
    expect((await parseJson(get)).data.name).toBe('Sheets Conn');

    const del = await handlePlatformRequest(
      new Request(`${BASE_URL}/connections/Sheets%20Conn`, { method: 'DELETE' }),
      ctx,
      ['connections', 'Sheets Conn'],
    );
    expect((await parseJson(del)).data.deleted).toBe(true);

    const missing = await handlePlatformRequest(
      new Request(`${BASE_URL}/connections/missing`, { method: 'GET' }),
      ctx,
      ['connections', 'missing'],
    );
    expect(missing.status).toBe(404);
  });

  it('validates connection create payloads', async () => {
    asOwner();
    const ctx = makeDataContext(publicArtifactEnv());
    const invalid = await handlePlatformRequest(
      new Request(`${BASE_URL}/connections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'x' }),
      }),
      ctx,
      ['connections'],
    );
    expect(invalid.status).toBe(400);

    const unknownProvider = await handlePlatformRequest(
      new Request(`${BASE_URL}/connections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'x',
          provider: 'nope',
          credentials: { access_token: 't' },
        }),
      }),
      ctx,
      ['connections'],
    );
    expect(unknownProvider.status).toBe(404);
  });

  it('handles cache status and refresh routes', async () => {
    const ctx = makeDataContext(publicArtifactEnv());
    const status = await handlePlatformRequest(
      new Request(`${BASE_URL}/cache/status`, { method: 'GET' }),
      ctx,
      ['cache', 'status'],
    );
    expect((await parseJson(status)).data.memoryEntries).toBe(0);

    const refresh = await handlePlatformRequest(
      new Request(`${BASE_URL}/cache/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'google-sheets', endpoint: 'values.get' }),
      }),
      ctx,
      ['cache', 'refresh'],
    );
    expect((await parseJson(refresh)).data.invalidated).toBeGreaterThanOrEqual(0);
  });

  it('records usage when provider and connection are present', async () => {
    const ctx = makeDataContext(publicArtifactEnv());
    const recorded = await handlePlatformRequest(
      new Request(`${BASE_URL}/usage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'google-sheets', connectionId: 'conn_1' }),
      }),
      ctx,
      ['usage'],
    );
    expect((await parseJson(recorded)).data.recorded).toBe(true);

    const skipped = await handlePlatformRequest(
      new Request(`${BASE_URL}/usage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      ctx,
      ['usage'],
    );
    expect((await parseJson(skipped)).data.recorded).toBe(false);
  });

  it('builds auth URLs and handles OAuth callbacks', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      access_token: 'tok',
      expires_in: 3600,
    }), { status: 200 })));

    const ctx = makeDataContext(publicArtifactEnv({}, { run: () => ({ meta: { changes: 1 } }) }));
    const authUrl = await handlePlatformRequest(
      new Request(`${BASE_URL}/google-sheets/auth-url?connection=my-conn&returnUrl=/done`, { method: 'GET' }),
      ctx,
      ['google-sheets', 'auth-url'],
    );
    expect((await parseJson(authUrl)).data.authUrl).toContain('accounts.google.com');

    const state = btoa(JSON.stringify({
      artifactId: ARTIFACT_ID,
      connectionName: 'my-conn',
      returnUrl: '/done',
      ts: Date.now(),
    }));

    const callback = await handlePlatformRequest(
      new Request(`${BASE_URL}/google-sheets/callback?code=abc&state=${encodeURIComponent(state)}`, {
        method: 'GET',
      }),
      ctx,
      ['google-sheets', 'callback'],
    );
    expect(callback.headers.get('Content-Type')).toContain('text/html');
    expect(await callback.text()).toContain('Connected successfully');
  });

  it('rejects callback requests without code or state', async () => {
    const response = await handlePlatformRequest(
      new Request(`${BASE_URL}/google-sheets/callback`, { method: 'GET' }),
      makeDataContext(publicArtifactEnv()),
      ['google-sheets', 'callback'],
    );
    expect(response.status).toBe(400);
  });

  it('prepares direct mode credentials and validates input', async () => {
    asOwner();
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

    const invalid = await handlePlatformRequest(
      new Request(`${BASE_URL}/google-sheets/prepare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      makeDataContext(env),
      ['google-sheets', 'prepare'],
    );
    expect(invalid.status).toBe(400);

    const prepared = await handlePlatformRequest(
      new Request(`${BASE_URL}/google-sheets/prepare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: 'conn_1', endpoint: 'values.get' }),
      }),
      makeDataContext(env),
      ['google-sheets', 'prepare'],
    );
    expect((await parseJson(prepared)).data.mode).toBe('direct');
  });

  it('executes endpoints with connection id or proxy token', async () => {
    asOwner();
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ spreadsheetId: 'x' }), { status: 200 })));

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

    const missing = await handlePlatformRequest(
      new Request(`${BASE_URL}/google-sheets/spreadsheets.get/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      makeDataContext(env),
      ['google-sheets', 'spreadsheets.get/execute'],
    );
    expect(missing.status).toBe(400);

    const executed = await handlePlatformRequest(
      new Request(`${BASE_URL}/google-sheets/spreadsheets.get/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId: 'conn_1',
          params: { pathParams: { spreadsheetId: 'sheet-1' } },
        }),
      }),
      makeDataContext(env),
      ['google-sheets', 'spreadsheets.get/execute'],
    );
    const body = await parseJson<{ data: { success: boolean } }>(executed);
    expect(body.data.success).toBe(true);
  });

  it('lets a workspace member execute a non-private workspace connection', async () => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(false);
    vi.spyOn(middleware, 'verifyWorkspaceConnectionAccess').mockResolvedValue(true);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ spreadsheetId: 'x' }), { status: 200 })));

    const { encrypted, iv } = await encryptTestCredentials({ access_token: 'tok', expires_at: Date.now() + 3_600_000 });
    const env = publicArtifactEnv({}, {
      first: () => ({
        id: 'conn_1', scope_type: 'artifact',
    scope_id: ARTIFACT_ID, name: 'c', provider: 'google-sheets',
        config: '{}', encrypted_credentials: encrypted, iv, preferred_mode: 'auto', created_at: '', updated_at: '',
      }),
    });

    const res = await handlePlatformRequest(
      new Request(`${BASE_URL}/google-sheets/spreadsheets.get/execute`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: 'conn_1', params: { pathParams: { spreadsheetId: 'sheet-1' } } }),
      }),
      makeDataContext(env),
      ['google-sheets', 'spreadsheets.get/execute'],
    );
    expect((await parseJson<{ data: { success: boolean } }>(res)).data.success).toBe(true);
  });

  it('forbids execution for a non-owner who is not a workspace member', async () => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(false);
    vi.spyOn(middleware, 'verifyWorkspaceConnectionAccess').mockResolvedValue(false);

    const res = await handlePlatformRequest(
      new Request(`${BASE_URL}/google-sheets/spreadsheets.get/execute`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: 'conn_1', params: {} }),
      }),
      makeDataContext(publicArtifactEnv()),
      ['google-sheets', 'spreadsheets.get/execute'],
    );
    expect(res.status).toBe(403);
  });

  it('executes with a valid proxy token', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ spreadsheetId: 'x' }), { status: 200 })));

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

    const { encryptCredentials } = await import('../../../../src/data/connections/credentials');
    const proxyPayload = await encryptCredentials({
      artifactId: ARTIFACT_ID,
      connectionId: 'conn_1',
      provider: 'google-sheets',
      issuedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    }, env.CREDENTIALS_KEY!);
    const proxyToken = `${proxyPayload.encrypted}.${proxyPayload.iv}`;

    const response = await handlePlatformRequest(
      new Request(`${BASE_URL}/google-sheets/spreadsheets.get/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proxyToken,
          params: { pathParams: { spreadsheetId: 'sheet-1' } },
        }),
      }),
      makeDataContext(env),
      ['google-sheets', 'spreadsheets.get/execute'],
    );
    expect((await parseJson(response)).data.success).toBe(true);
  });

  it('stores shopify shop config on OAuth callback', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      access_token: 'shop-tok',
      scope: 'read_products',
    }), { status: 200 })));

    const runBindings: unknown[][] = [];
    const env = publicArtifactEnv({}, {
      run: (_sql, bindings) => {
        runBindings.push(bindings);
        return { meta: { changes: 1 } };
      },
    });

    const state = btoa(JSON.stringify({
      artifactId: ARTIFACT_ID,
      connectionName: 'shop-conn',
      returnUrl: '/',
      ts: Date.now(),
    }));

    const response = await handlePlatformRequest(
      new Request(`${BASE_URL}/shopify/callback?code=abc&state=${encodeURIComponent(state)}&shop=demo.myshopify.com`, {
        method: 'GET',
      }),
      makeDataContext(env),
      ['shopify', 'callback'],
    );

    expect(response.status).toBe(200);
    expect(runBindings.some((b) => b[2] === 'shop-conn')).toBe(true);
  });

  it('returns 404 for unknown nested platform paths', async () => {
    const response = await handlePlatformRequest(
      new Request(`${BASE_URL}/google-sheets/unknown-path`, { method: 'GET' }),
      makeDataContext(publicArtifactEnv()),
      ['google-sheets', 'unknown-path'],
    );
    expect(response.status).toBe(404);
  });
});
