// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  handleListWorkspaceConnections,
  handleWorkspaceConnectorsCatalog,
  handleTestWorkspaceConnection,
  handleCreateWorkspaceConnection,
  handleDeleteWorkspaceConnection,
  handleSlackInstall,
  summarizeCredentials,
  validateName,
  buildProbeCredentials,
} from '../../../../src/router/api/workspace-connections';
import * as platform from '../../../../src/data/platform';
import type { Env } from '../../../../src/types';
import type { AuthUser } from '../../../../src/api-auth';

// B14: connection create schedules a best-effort catalog seed. Assert the wiring
// (called with the right ids, doesn't block/break create) without exercising the
// real provider-listing logic — that's covered by catalog/seed-resources.test.ts.
const catalogSeedMock = vi.fn(async () => ({ seeded: 0, skipped: 0, provider: null }));
vi.mock('../../../../src/catalog', () => ({
  seedCatalogForConnection: (...args: unknown[]) => catalogSeedMock(...args),
}));

const CREDENTIALS_KEY = 'test-credentials-key-32bytes!!';
const WORKSPACE_ID = 'wsp_team';
const USER: AuthUser = { id: 'usr_member', email: 'm@example.com', username: null };

function fakeExecutionCtx() {
  const waited: Promise<unknown>[] = [];
  return {
    ctx: { waitUntil: (p: Promise<unknown>) => { waited.push(p); }, passThroughOnException() {} } as unknown as ExecutionContext,
    settle: () => Promise.all(waited),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  catalogSeedMock.mockClear();
});

interface DbHandlers {
  role?: string | null;
  existingConnection?: unknown;
  existingDeleteTarget?: unknown;
  listRows?: unknown[];
  onRun?: (sql: string, bindings: unknown[]) => void;
}

function makeEnv(h: DbHandlers): Env {
  const prepare = vi.fn((sql: string) => ({
    bind: (...bindings: unknown[]) => ({
      first: vi.fn(async () => {
        if (sql.includes('FROM workspace_members')) {
          return h.role !== undefined ? (h.role === null ? null : { role: h.role }) : { role: 'member' };
        }
        if (sql.includes("SELECT id FROM connections")) {
          // create-time conflict check vs delete-time existence check
          return sql.includes('AND name = ?') ? (h.existingConnection ?? null) : (h.existingDeleteTarget ?? null);
        }
        return null;
      }),
      all: vi.fn(async () => ({ results: h.listRows ?? [] })),
      run: vi.fn(async () => {
        h.onRun?.(sql, bindings);
        return { meta: { changes: 1 } };
      }),
    }),
  }));
  return { CREDENTIALS_KEY, DB: { prepare } } as unknown as Env;
}

describe('workspace connections routes', () => {
  it('rejects non-members', async () => {
    const env = makeEnv({ role: null });
    const res = await handleListWorkspaceConnections(env, USER, WORKSPACE_ID);
    expect(res.status).toBe(403);
  });

  it('lists shared connectors without secrets', async () => {
    const env = makeEnv({
      role: 'member',
      listRows: [{
        id: 'conn_1', name: 'Team API', kind: 'generic', provider: 'rest_api',
        auth_type: 'api_key', config: '{"baseUrl":"https://api.x"}', preferred_mode: 'auto',
        cache_ttl_seconds: 300, rate_limit_rpm: 60, created_by: 'usr_member',
        created_at: 'x', updated_at: 'x',
      }],
    });
    const res = await handleListWorkspaceConnections(env, USER, WORKSPACE_ID);
    expect(res.status).toBe(200);
    const body = await res.json() as { connections: Array<Record<string, unknown>> };
    expect(body.connections).toHaveLength(1);
    expect(body.connections[0]).toMatchObject({ id: 'conn_1', kind: 'generic', authType: 'api_key' });
    expect(JSON.stringify(body)).not.toContain('encrypted');
  });

  it('creates a static generic connector', async () => {
    let inserted: unknown[] | null = null;
    const env = makeEnv({
      role: 'admin',
      onRun: (sql, bindings) => {
        if (sql.includes('INSERT INTO connections')) inserted = bindings;
      },
    });
    const req = new Request('https://shareout.site/v1/workspaces/wsp_team/connections', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Team_API',
        type: 'rest_api',
        config: { baseUrl: 'https://api.x' },
        credentials: { type: 'api_key', data: { apiKey: 'secret' } },
      }),
    });
    const res = await handleCreateWorkspaceConnection(req, env, USER, WORKSPACE_ID);
    expect(res.status).toBe(201);
    expect(inserted).not.toBeNull();
    // bindings: id, workspace_id, name, provider(type), auth_type, config, encrypted, iv, ttl, rpm, created_by, credential_scope
    expect(inserted![1]).toBe(WORKSPACE_ID);
    expect(inserted![2]).toBe('Team_API');
    expect(inserted![3]).toBe('rest_api');
    expect(inserted![4]).toBe('api_key');
    expect(JSON.stringify(inserted![6])).not.toContain('secret');
    expect(inserted!.at(-1)).toBe('shared');
  });

  it('creates a Snowflake key-pair platform connector', async () => {
    let inserted: unknown[] | null = null;
    const env = makeEnv({
      role: 'admin',
      onRun: (sql, bindings) => {
        if (sql.includes('INSERT INTO connections')) inserted = bindings;
      },
    });
    const req = new Request('https://shareout.site/v1/workspaces/wsp_team/connections', {
      method: 'POST',
      body: JSON.stringify({
        name: 'acme_snowflake',
        kind: 'platform',
        provider: 'snowflake',
        config: { account: 'xy12345', user: 'SVC', warehouse: 'WH', database: 'DB', schema: 'S', publicKeyFingerprint: 'SHA256:fp' },
        credentials: { type: 'key_pair', data: { private_key: '-----BEGIN PRIVATE KEY-----\nMII\n-----END PRIVATE KEY-----' } },
      }),
    });
    const res = await handleCreateWorkspaceConnection(req, env, USER, WORKSPACE_ID);
    expect(res.status).toBe(201);
    const body = await res.json() as { kind: string; provider: string };
    expect(body).toMatchObject({ kind: 'platform', provider: 'snowflake' });
    // bindings: id, workspace_id, name, provider, auth_type, config, encrypted, iv, preferred_mode, created_by
    expect(inserted![3]).toBe('snowflake');
    expect(inserted![4]).toBe('key_pair');
    expect(JSON.stringify(inserted![6])).not.toContain('PRIVATE KEY');
  });

  it('schedules a catalog seed after a successful generic connector create', async () => {
    const env = makeEnv({ role: 'admin' });
    const { ctx, settle } = fakeExecutionCtx();
    const req = new Request('https://shareout.site/v1/workspaces/wsp_team/connections', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Team_API', type: 'rest_api', config: {},
        credentials: { type: 'api_key', data: { apiKey: 'secret' } },
      }),
    });
    const res = await handleCreateWorkspaceConnection(req, env, USER, WORKSPACE_ID, ctx);
    expect(res.status).toBe(201);
    const { id } = await res.json() as { id: string };
    await settle();
    expect(catalogSeedMock).toHaveBeenCalledWith(env, WORKSPACE_ID, id);
  });

  it('schedules a catalog seed after a successful platform connector create', async () => {
    const env = makeEnv({ role: 'admin' });
    const { ctx, settle } = fakeExecutionCtx();
    const req = new Request('https://shareout.site/v1/workspaces/wsp_team/connections', {
      method: 'POST',
      body: JSON.stringify({
        name: 'acme_snowflake', kind: 'platform', provider: 'snowflake',
        config: { account: 'xy12345', user: 'SVC', warehouse: 'WH', database: 'DB', schema: 'S', publicKeyFingerprint: 'SHA256:fp' },
        credentials: { type: 'key_pair', data: { private_key: 'pk' } },
      }),
    });
    const res = await handleCreateWorkspaceConnection(req, env, USER, WORKSPACE_ID, ctx);
    expect(res.status).toBe(201);
    await settle();
    expect(catalogSeedMock).toHaveBeenCalledTimes(1);
  });

  it('does not schedule (or block on) seeding when there is no waitUntil context', async () => {
    const env = makeEnv({ role: 'admin' });
    const req = new Request('https://shareout.site/v1/workspaces/wsp_team/connections', {
      method: 'POST',
      body: JSON.stringify({
        name: 'no_ctx', type: 'rest_api', config: {},
        credentials: { type: 'api_key', data: { apiKey: 'secret' } },
      }),
    });
    const res = await handleCreateWorkspaceConnection(req, env, USER, WORKSPACE_ID);
    expect(res.status).toBe(201);
    expect(catalogSeedMock).not.toHaveBeenCalled();
  });

  it('a seeding failure never fails the connection create', async () => {
    catalogSeedMock.mockRejectedValueOnce(new Error('boom'));
    const env = makeEnv({ role: 'admin' });
    const { ctx, settle } = fakeExecutionCtx();
    const req = new Request('https://shareout.site/v1/workspaces/wsp_team/connections', {
      method: 'POST',
      body: JSON.stringify({
        name: 'flaky', type: 'rest_api', config: {},
        credentials: { type: 'api_key', data: { apiKey: 'secret' } },
      }),
    });
    const res = await handleCreateWorkspaceConnection(req, env, USER, WORKSPACE_ID, ctx);
    expect(res.status).toBe(201);
    await expect(settle()).resolves.toBeDefined();
  });

  it('rejects key_pair without a private_key', async () => {
    const env = makeEnv({ role: 'admin' });
    const req = new Request('https://x/connections', {
      method: 'POST',
      body: JSON.stringify({
        name: 'sf_bad', kind: 'platform', provider: 'snowflake',
        credentials: { type: 'key_pair', data: {} },
      }),
    });
    const res = await handleCreateWorkspaceConnection(req, env, USER, WORKSPACE_ID);
    expect(res.status).toBe(400);
  });

  it('forbids non-admin members from creating connectors', async () => {
    const env = makeEnv({ role: 'member' });
    const req = new Request('https://x/connections', {
      method: 'POST',
      body: JSON.stringify({ name: 'x', type: 'rest_api', credentials: { type: 'api_key', data: { apiKey: 'k' } } }),
    });
    const res = await handleCreateWorkspaceConnection(req, env, USER, WORKSPACE_ID);
    expect(res.status).toBe(403);
  });

  it('rejects invalid generic type', async () => {
    const env = makeEnv({ role: 'admin' });
    const req = new Request('https://x/connections', {
      method: 'POST',
      body: JSON.stringify({ name: 'bad', type: 'mysql', credentials: { type: 'api_key', data: {} } }),
    });
    const res = await handleCreateWorkspaceConnection(req, env, USER, WORKSPACE_ID);
    expect(res.status).toBe(400);
  });

  it('409s on duplicate name', async () => {
    const env = makeEnv({ role: 'admin', existingConnection: { id: 'conn_existing' } });
    const req = new Request('https://x/connections', {
      method: 'POST',
      body: JSON.stringify({ name: 'dup', type: 'rest_api', credentials: { type: 'api_key', data: { apiKey: 'k' } } }),
    });
    const res = await handleCreateWorkspaceConnection(req, env, USER, WORKSPACE_ID);
    expect(res.status).toBe(409);
  });

  it('deletes a shared connector', async () => {
    const env = makeEnv({ role: 'admin', existingDeleteTarget: { id: 'conn_1' } });
    const res = await handleDeleteWorkspaceConnection(env, USER, WORKSPACE_ID, 'conn_1');
    expect(res.status).toBe(200);
    const body = await res.json() as { deleted: boolean };
    expect(body.deleted).toBe(true);
  });

  it('404s when deleting a missing connector', async () => {
    const env = makeEnv({ role: 'admin', existingDeleteTarget: null });
    const res = await handleDeleteWorkspaceConnection(env, USER, WORKSPACE_ID, 'conn_missing');
    expect(res.status).toBe(404);
  });
});

describe('validateName', () => {
  it('rejects empty and invalid connector names', () => {
    expect(validateName('')).toBe('Name is required');
    expect(validateName('a'.repeat(65))).toBe('Name too long (max 64 chars)');
    expect(validateName('bad name!')).toBe('Name contains invalid characters');
    expect(validateName('my_connector-1')).toBeNull();
  });
});

describe('buildProbeCredentials', () => {
  it('maps credential types for connection probes', () => {
    const sa = { client_email: 'x@y.z', private_key: 'pk' };
    expect(buildProbeCredentials({ type: 'service_account', data: sa })).toEqual({
      access_token: '',
      extra: { service_account: sa },
    });
    expect(buildProbeCredentials({ type: 'api_key', data: { api_key: 'secret' } })).toEqual({
      access_token: 'secret',
    });
  });
});

describe('summarizeCredentials', () => {
  it('surfaces non-secret identifiers and never the secret values', () => {
    // Service account (BigQuery): client_email/project_id are safe; private_key is secret.
    const sa = summarizeCredentials({
      access_token: '',
      extra: { service_account: { client_email: 'svc@p.iam', project_id: 'proj-1', private_key: 'PRIVATE-KEY-VALUE' } },
    });
    expect(sa.identifiers).toMatchObject({ client_email: 'svc@p.iam', project_id: 'proj-1' });
    expect(sa.secretsConfigured).toContain('private_key');
    expect(JSON.stringify(sa)).not.toContain('PRIVATE-KEY-VALUE');

    // Slack OAuth: team/bot identifiers safe; access_token secret.
    const slack = summarizeCredentials({
      access_token: 'xoxb-SECRET-TOKEN',
      extra: { team_id: 'T1', team_name: 'Acme', bot_user_id: 'U9' },
    });
    expect(slack.identifiers).toMatchObject({ team_id: 'T1', team_name: 'Acme', bot_user_id: 'U9' });
    expect(slack.secretsConfigured).toContain('access_token');
    expect(JSON.stringify(slack)).not.toContain('xoxb-SECRET-TOKEN');

    // REST api_key: header_name safe; api_key secret. Unknown keys dropped.
    const rest = summarizeCredentials({ api_key: 'SECRET', header_name: 'Authorization', weird: 'DROP-ME' });
    expect(rest.identifiers).toEqual({ header_name: 'Authorization' });
    expect(rest.secretsConfigured).toContain('api_key');
    expect(JSON.stringify(rest)).not.toContain('SECRET');
    expect(JSON.stringify(rest)).not.toContain('DROP-ME');
  });

  it('catalog rejects non-members', async () => {
    const env = makeEnv({ role: null });
    const res = await handleWorkspaceConnectorsCatalog(env, USER, WORKSPACE_ID);
    expect(res.status).toBe(403);
  });

  it('test route verifies credentials without saving (Facebook Ads happy path)', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ name: 'Acme Ads', currency: 'USD' }), { status: 200 })
    );
    const env = makeEnv({ role: 'admin' });
    const req = new Request('https://shareout.site/v1/workspaces/wsp_team/connections/test', {
      method: 'POST',
      body: JSON.stringify({
        provider: 'facebook-ads',
        config: { account_id: 'act_123' },
        credentials: { type: 'oauth', data: { access_token: 'TOK' } },
      }),
    });
    const res = await handleTestWorkspaceConnection(req, env, USER, WORKSPACE_ID);
    const body = await res.json() as { ok: boolean; message?: string };
    expect(body.ok).toBe(true);
    expect(String(fetchMock.mock.calls[0][0])).toContain('graph.facebook.com');
    vi.restoreAllMocks();
  });

  it('test route returns testable:false for a provider without a probe', async () => {
    const env = makeEnv({ role: 'admin' });
    const req = new Request('https://shareout.site/v1/workspaces/wsp_team/connections/test', {
      method: 'POST',
      body: JSON.stringify({ provider: 'bigquery', config: {}, credentials: { type: 'service_account', data: {} } }),
    });
    const res = await handleTestWorkspaceConnection(req, env, USER, WORKSPACE_ID);
    const body = await res.json() as { testable?: boolean };
    expect(body.testable).toBe(false);
  });

  it('test route rejects non-admins', async () => {
    const env = makeEnv({ role: 'member' });
    const req = new Request('https://shareout.site/v1/workspaces/wsp_team/connections/test', {
      method: 'POST', body: JSON.stringify({ provider: 'facebook-ads', config: {}, credentials: { type: 'oauth', data: {} } }),
    });
    const res = await handleTestWorkspaceConnection(req, env, USER, WORKSPACE_ID);
    expect(res.status).toBe(403);
  });

  it('does not leak internal error messages when verifyConnection throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(platform, 'hasProvider').mockReturnValue(true);
    vi.spyOn(platform, 'getProvider').mockReturnValue({
      verifyConnection: vi.fn().mockRejectedValue(new Error('D1_ERROR: no such table: secret_internal')),
    } as never);

    const env = makeEnv({ role: 'admin' });
    const req = new Request('https://shareout.site/v1/workspaces/wsp_team/connections/test', {
      method: 'POST',
      body: JSON.stringify({
        provider: 'test-provider',
        config: {},
        credentials: { type: 'oauth', data: {} },
      }),
    });
    const res = await handleTestWorkspaceConnection(req, env, USER, WORKSPACE_ID);
    const body = await res.json() as { ok: boolean; message?: string };

    expect(body).toMatchObject({ ok: false, message: 'Connection test failed' });
    expect(body.message).not.toContain('D1_ERROR');
    expect(body.message).not.toContain('secret_internal');
    expect(consoleError).toHaveBeenCalled();
  });

  it('catalog includes the token-shim ads providers', async () => {
    const env = makeEnv({ role: 'admin', listRows: [] });
    const res = await handleWorkspaceConnectorsCatalog(env, USER, WORKSPACE_ID);
    const body = await res.json() as { catalog: Array<{ id: string; category: string; connectMethod: string }> };
    const fb = body.catalog.find((c) => c.id === 'facebook-ads');
    const ga = body.catalog.find((c) => c.id === 'google-ads');
    expect(fb).toMatchObject({ category: 'ads', connectMethod: 'token' });
    expect(ga).toMatchObject({ category: 'ads', connectMethod: 'token' });
  });

  it('creates a Facebook Ads token-shim connector', async () => {
    let inserted: unknown[] | null = null;
    const env = makeEnv({
      role: 'admin',
      onRun: (sql, bindings) => { if (sql.includes('INSERT INTO connections')) inserted = bindings; },
    });
    const req = new Request('https://shareout.site/v1/workspaces/wsp_team/connections', {
      method: 'POST',
      body: JSON.stringify({
        name: 'meta', kind: 'platform', provider: 'facebook-ads',
        config: { account_id: 'act_123' },
        credentials: { type: 'oauth', data: { access_token: 'EAAG-secret-token' } },
      }),
    });
    const res = await handleCreateWorkspaceConnection(req, env, USER, WORKSPACE_ID);
    expect(res.status).toBe(201);
    expect(inserted![3]).toBe('facebook-ads');
    expect(JSON.stringify(inserted![6])).not.toContain('EAAG-secret-token');
  });

  it('creates a Google Ads token-shim connector carrying the developer token', async () => {
    let inserted: unknown[] | null = null;
    const env = makeEnv({
      role: 'admin',
      onRun: (sql, bindings) => { if (sql.includes('INSERT INTO connections')) inserted = bindings; },
    });
    const req = new Request('https://shareout.site/v1/workspaces/wsp_team/connections', {
      method: 'POST',
      body: JSON.stringify({
        name: 'gads', kind: 'platform', provider: 'google-ads',
        config: { customer_id: '123-456-7890' },
        credentials: { type: 'authorized_user', data: { client_id: 'cid', client_secret: 'csec', refresh_token: 'rtok', developer_token: 'devtok' } },
      }),
    });
    const res = await handleCreateWorkspaceConnection(req, env, USER, WORKSPACE_ID);
    expect(res.status).toBe(201);
    expect(inserted![3]).toBe('google-ads');
    expect(inserted![4]).toBe('authorized_user');
    // Secrets are encrypted, never stored in cleartext bindings.
    expect(JSON.stringify(inserted![6])).not.toContain('devtok');
    expect(JSON.stringify(inserted![6])).not.toContain('rtok');
  });

  it('catalog lists available providers and groups connected ones', async () => {
    const env = makeEnv({
      role: 'admin',
      listRows: [{
        id: 'conn_ga', name: 'analytics', kind: 'platform', provider: 'google-analytics',
        auth_type: 'oauth2', config: '{}', credential_scope: 'shared', created_at: 'x',
      }],
    });
    const res = await handleWorkspaceConnectorsCatalog(env, USER, WORKSPACE_ID);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      canManage: boolean;
      catalog: Array<{ id: string; label: string; category: string; connectMethod: string; connections: Array<{ name: string }> }>;
    };
    expect(body.canManage).toBe(true);
    const ga = body.catalog.find((c) => c.id === 'google-analytics');
    expect(ga).toBeTruthy();
    expect(ga!.category).toBe('analytics');
    expect(ga!.connectMethod).toBe('service_account');
    expect(ga!.connections).toHaveLength(1);
    expect(ga!.connections[0].name).toBe('analytics');
    // A registered provider with no connection still appears, empty.
    const shopify = body.catalog.find((c) => c.id === 'shopify');
    expect(shopify).toBeTruthy();
    expect(shopify!.connections).toHaveLength(0);
    expect(JSON.stringify(body)).not.toContain('encrypted');
  });

  it('pins Slack redirect_uri to the canonical host even when installed from a subdomain', async () => {
    const env = {
      ...makeEnv({ role: 'owner' }),
      SLACK_CLIENT_ID: 'cid',
      SHAREOUT_BASE_URL: 'https://shareout.site',
    } as unknown as Env;
    // Install initiated from a workspace subdomain — request origin is NOT the apex.
    const req = new Request('https://acme.shareout.site/v1/workspaces/wsp_team/connections/slack/install?connection=slack');
    const res = await handleSlackInstall(req, env, USER, WORKSPACE_ID);
    expect(res.status).toBe(302);
    const authUrl = new URL(res.headers.get('Location')!);
    expect(authUrl.searchParams.get('redirect_uri')).toBe('https://shareout.site/v1/oauth/slack/callback');
  });
});
