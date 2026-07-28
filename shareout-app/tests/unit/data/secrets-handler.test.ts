// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleSecrets } from '../../../src/data/secrets/handler';
import { encryptCredentials } from '../../../src/data/connections/credentials';
import * as middleware from '../../../src/data/middleware';
import type { DataContext } from '../../../src/data/middleware';
import type { Env } from '../../../src/types';

vi.mock('../../../src/crypto-utils', () => ({
  generateId: vi.fn((prefix: string) => `${prefix}_test1234567890ab`),
}));

const ARTIFACT_ID = 'art_test';
const BASE_URL = 'https://shareout.example.com';
const ORIGIN = 'https://app.example.com';
const CREDENTIALS_KEY = 'test-credentials-key-32-chars!!';

interface SecretRow {
  id: string;
  artifact_id: string;
  name: string;
  description: string | null;
  allowed_hosts: string;
  allowed_methods: string;
  allowed_paths: string;
  credentials_id: string | null;
  injection_type: string;
  injection_config: string | null;
  rate_limit_rpm: number;
  created_at: string;
  updated_at: string;
  encrypted_data?: string | null;
  iv?: string | null;
}

interface AuditLogRow {
  id: string;
  method: string;
  host: string;
  path: string;
  status_code: number | null;
  error: string | null;
  execution_time_ms: number | null;
  created_at: string;
}

type DbScenario = {
  secretList?: SecretRow[];
  secret?: SecretRow | null;
  secretByName?: Record<string, SecretRow | null>;
  existingSecret?: { id: string } | null;
  auditLogs?: AuditLogRow[];
};

function dbFirst(sql: string, args: unknown[], scenario: DbScenario): unknown {
  const nameArg = args.find((a) => typeof a === 'string' && a !== ARTIFACT_ID) as string | undefined;

  if (sql.includes('SELECT id FROM artifact_secrets')) {
    return scenario.existingSecret ?? null;
  }

  if (sql.includes('SELECT id, credentials_id FROM artifact_secrets')) {
    if (nameArg && scenario.secretByName?.[nameArg] !== undefined) {
      const s = scenario.secretByName[nameArg];
      return s ? { id: s.id, credentials_id: s.credentials_id } : null;
    }
    return scenario.secret
      ? { id: scenario.secret.id, credentials_id: scenario.secret.credentials_id }
      : null;
  }

  if (sql.includes('SELECT s.*, c.encrypted_data')) {
    if (nameArg && scenario.secretByName?.[nameArg] !== undefined) {
      return scenario.secretByName[nameArg];
    }
    return scenario.secret ?? null;
  }

  if (sql.includes('FROM artifact_secrets') && sql.includes('allowed_paths')) {
    if (nameArg && scenario.secretByName?.[nameArg] !== undefined) {
      return scenario.secretByName[nameArg];
    }
    return scenario.secret ?? null;
  }

  return null;
}

function makeSecretsEnv(
  scenario: DbScenario = {},
  options: { bindCaptures?: Array<{ sql: string; args: unknown[] }>; credentialsKey?: string | null } = {},
): Env {
  const DB = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...bindArgs: unknown[]) => {
        options.bindCaptures?.push({ sql, args: bindArgs });
        return {
          first: vi.fn(async () => dbFirst(sql, bindArgs, scenario)),
          all: vi.fn(async () => {
            if (sql.includes('secret_audit_log')) {
              return { results: scenario.auditLogs ?? [] };
            }
            return { results: scenario.secretList ?? [] };
          }),
          run: vi.fn(async () => ({ success: true, meta: { changes: 1 } })),
        };
      }),
    })),
  } as unknown as Env['DB'];

  return {
    DB,
    CREDENTIALS_KEY: options.credentialsKey === null ? undefined : (options.credentialsKey ?? CREDENTIALS_KEY),
  } as Env;
}

function makeCtx(env: Env, origin: string | null = ORIGIN): DataContext {
  return {
    artifactId: ARTIFACT_ID,
    artifact: {
      id: ARTIFACT_ID,
      name: 'Test Artifact',
      visibility: 'public',
      auth_method: null,
    },
    env,
    origin,
  };
}

function secretsRequest(
  method: string,
  path: string,
  body?: unknown,
  init: RequestInit = {},
): Request {
  const headers = new Headers(init.headers ?? {});
  const url = `${BASE_URL}/v1/data/${ARTIFACT_ID}/secrets${path ? `/${path}` : ''}`;
  if (body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return new Request(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...init,
  });
}

function validSecretBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'stripe_key',
    description: 'Stripe API key',
    allowedHosts: ['api.stripe.com'],
    allowedMethods: ['GET', 'POST'],
    allowedPaths: ['/v1/*'],
    injectionType: 'bearer',
    credentials: { value: 'sk_test_123' },
    rateLimit: 60,
    ...overrides,
  };
}

const sampleSecret: SecretRow = {
  id: 'sec_abc',
  artifact_id: ARTIFACT_ID,
  name: 'stripe_key',
  description: 'Stripe API key',
  allowed_hosts: '["api.stripe.com"]',
  allowed_methods: '["GET","POST"]',
  allowed_paths: '["/v1/*"]',
  credentials_id: 'scr_abc',
  injection_type: 'bearer',
  injection_config: JSON.stringify({ prefix: 'Bearer ' }),
  rate_limit_rpm: 60,
  created_at: '2026-05-30T14:00:00.000Z',
  updated_at: '2026-05-30T14:00:00.000Z',
};

let encryptedSample: { encrypted: string; iv: string };

beforeAll(async () => {
  encryptedSample = await encryptCredentials(
    { value: 'sk_test_123', username: 'user', password: 'pass' },
    CREDENTIALS_KEY,
  );
});

beforeEach(() => {
  vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('handleSecrets routing', () => {
  it('returns 404 for unknown routes', async () => {
    const env = makeSecretsEnv();
    const response = await handleSecrets(
      secretsRequest('PATCH', 'unknown'),
      makeCtx(env),
      'unknown',
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('returns 403 when owner verification fails on protected routes', async () => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(false);
    const env = makeSecretsEnv();

    const list = await handleSecrets(secretsRequest('GET', ''), makeCtx(env), '');
    expect(list.status).toBe(403);

    const create = await handleSecrets(
      secretsRequest('POST', '', validSecretBody()),
      makeCtx(env),
      '',
    );
    expect(create.status).toBe(403);

    const get = await handleSecrets(secretsRequest('GET', 'stripe_key'), makeCtx(env), 'stripe_key');
    expect(get.status).toBe(403);

    const update = await handleSecrets(
      secretsRequest('PUT', 'stripe_key', { description: 'updated' }),
      makeCtx(env),
      'stripe_key',
    );
    expect(update.status).toBe(403);

    const del = await handleSecrets(
      secretsRequest('DELETE', 'stripe_key'),
      makeCtx(env),
      'stripe_key',
    );
    expect(del.status).toBe(403);

    const audit = await handleSecrets(
      secretsRequest('GET', 'stripe_key/audit'),
      makeCtx(env),
      'stripe_key/audit',
    );
    expect(audit.status).toBe(403);

    const proxy = await handleSecrets(
      secretsRequest('POST', 'stripe_key/proxy', { path: '/v1/test' }),
      makeCtx(env),
      'stripe_key/proxy',
    );
    expect(proxy.status).toBe(403);
  });
});

describe('listSecrets', () => {
  it('returns mapped secret summaries', async () => {
    const env = makeSecretsEnv({
      secretList: [
        sampleSecret,
        {
          ...sampleSecret,
          id: 'sec_def',
          name: 'openai_key',
          description: null,
          injection_type: 'header',
          rate_limit_rpm: 30,
        },
      ],
    });
    const response = await handleSecrets(secretsRequest('GET', ''), makeCtx(env), '');

    expect(response.status).toBe(200);
    const body = await response.json() as {
      data: { count: number; secrets: Array<{ name: string; allowedHosts: string[] }> };
    };
    expect(body.data.count).toBe(2);
    expect(body.data.secrets[0]).toMatchObject({
      name: 'stripe_key',
      allowedHosts: ['api.stripe.com'],
      injectionType: 'bearer',
    });
  });
});

describe('getSecret', () => {
  it('returns 404 when secret is missing', async () => {
    const env = makeSecretsEnv({ secret: null });
    const response = await handleSecrets(
      secretsRequest('GET', 'missing'),
      makeCtx(env),
      'missing',
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: 'SECRET_NOT_FOUND' });
  });

  it('returns full secret metadata without credentials', async () => {
    const env = makeSecretsEnv({ secret: sampleSecret });
    const response = await handleSecrets(
      secretsRequest('GET', 'stripe_key'),
      makeCtx(env),
      'stripe_key',
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { data: Record<string, unknown> };
    expect(body.data).toMatchObject({
      name: 'stripe_key',
      allowedHosts: ['api.stripe.com'],
      allowedMethods: ['GET', 'POST'],
      allowedPaths: ['/v1/*'],
      injectionType: 'bearer',
      injectionConfig: { prefix: 'Bearer ' },
    });
  });
});

describe('createSecret', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-30T14:00:00.000Z'));
  });

  it('returns 500 when CREDENTIALS_KEY is missing', async () => {
    const env = makeSecretsEnv({}, { credentialsKey: null });
    const response = await handleSecrets(
      secretsRequest('POST', '', validSecretBody()),
      makeCtx(env),
      '',
    );
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ code: 'CONFIG_ERROR' });
  });

  it('returns 400 for invalid JSON', async () => {
    const env = makeSecretsEnv();
    const response = await handleSecrets(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/secrets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      }),
      makeCtx(env),
      '',
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'INVALID_JSON' });
  });

  it('validates secret name', async () => {
    const env = makeSecretsEnv();

    const empty = await handleSecrets(
      secretsRequest('POST', '', validSecretBody({ name: '' })),
      makeCtx(env),
      '',
    );
    expect(empty.status).toBe(400);
    await expect(empty.json()).resolves.toMatchObject({ code: 'INVALID_SECRET_NAME' });

    const tooLong = await handleSecrets(
      secretsRequest('POST', '', validSecretBody({ name: 'a'.repeat(65) })),
      makeCtx(env),
      '',
    );
    expect(tooLong.status).toBe(400);

    const badChars = await handleSecrets(
      secretsRequest('POST', '', validSecretBody({ name: 'bad name!' })),
      makeCtx(env),
      '',
    );
    expect(badChars.status).toBe(400);
  });

  it('validates required arrays and methods', async () => {
    const env = makeSecretsEnv();

    const noHosts = await handleSecrets(
      secretsRequest('POST', '', validSecretBody({ allowedHosts: [] })),
      makeCtx(env),
      '',
    );
    expect(noHosts.status).toBe(400);
    await expect(noHosts.json()).resolves.toMatchObject({ param: 'allowedHosts' });

    const noMethods = await handleSecrets(
      secretsRequest('POST', '', validSecretBody({ allowedMethods: [] })),
      makeCtx(env),
      '',
    );
    expect(noMethods.status).toBe(400);
    await expect(noMethods.json()).resolves.toMatchObject({ param: 'allowedMethods' });

    const badMethod = await handleSecrets(
      secretsRequest('POST', '', validSecretBody({ allowedMethods: ['FETCH'] })),
      makeCtx(env),
      '',
    );
    expect(badMethod.status).toBe(400);
    await expect(badMethod.json()).resolves.toMatchObject({ code: 'INVALID_METHOD' });
  });

  it('validates path patterns, injection type, and credentials', async () => {
    const env = makeSecretsEnv();

    const badPath = await handleSecrets(
      secretsRequest('POST', '', validSecretBody({ allowedPaths: ['../secret'] })),
      makeCtx(env),
      '',
    );
    expect(badPath.status).toBe(400);
    await expect(badPath.json()).resolves.toMatchObject({ code: 'INVALID_PATH_PATTERN' });

    const badInjection = await handleSecrets(
      secretsRequest('POST', '', validSecretBody({ injectionType: 'cookie' })),
      makeCtx(env),
      '',
    );
    expect(badInjection.status).toBe(400);
    await expect(badInjection.json()).resolves.toMatchObject({ code: 'INVALID_INJECTION_TYPE' });

    const noCreds = await handleSecrets(
      secretsRequest('POST', '', validSecretBody({ credentials: {} })),
      makeCtx(env),
      '',
    );
    expect(noCreds.status).toBe(400);
    await expect(noCreds.json()).resolves.toMatchObject({ param: 'credentials.value' });
  });

  it('returns 409 when secret already exists', async () => {
    const env = makeSecretsEnv({ existingSecret: { id: 'sec_existing' } });
    const response = await handleSecrets(
      secretsRequest('POST', '', validSecretBody()),
      makeCtx(env),
      '',
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'SECRET_EXISTS' });
  });

  it('creates secret and stores encrypted credentials', async () => {
    const bindCaptures: Array<{ sql: string; args: unknown[] }> = [];
    const env = makeSecretsEnv({ existingSecret: null }, { bindCaptures });
    const response = await handleSecrets(
      secretsRequest('POST', '', validSecretBody()),
      makeCtx(env),
      '',
    );

    expect(response.status).toBe(201);
    const body = await response.json() as { data: { name: string; createdAt: string } };
    expect(body.data).toMatchObject({
      name: 'stripe_key',
      createdAt: '2026-05-30T14:00:00.000Z',
    });
    expect(bindCaptures.some((c) => c.sql.includes('INSERT INTO artifact_secret_credentials'))).toBe(true);
    expect(bindCaptures.some((c) => c.sql.includes('INSERT INTO artifact_secrets'))).toBe(true);
  });
});

describe('updateSecret', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-30T15:00:00.000Z'));
  });

  it('returns 500 when CREDENTIALS_KEY is missing', async () => {
    const env = makeSecretsEnv({ secret: sampleSecret }, { credentialsKey: null });
    const response = await handleSecrets(
      secretsRequest('PUT', 'stripe_key', { description: 'new' }),
      makeCtx(env),
      'stripe_key',
    );
    expect(response.status).toBe(500);
  });

  it('returns 404 when secret is missing', async () => {
    const env = makeSecretsEnv({ secret: null });
    const response = await handleSecrets(
      secretsRequest('PUT', 'missing', { description: 'new' }),
      makeCtx(env),
      'missing',
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: 'SECRET_NOT_FOUND' });
  });

  it('returns 400 for invalid JSON', async () => {
    const env = makeSecretsEnv({ secret: sampleSecret });
    const response = await handleSecrets(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/secrets/stripe_key`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: '{bad',
      }),
      makeCtx(env),
      'stripe_key',
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'INVALID_JSON' });
  });

  it('validates partial update fields', async () => {
    const env = makeSecretsEnv({ secret: sampleSecret });

    const badHosts = await handleSecrets(
      secretsRequest('PUT', 'stripe_key', { allowedHosts: [] }),
      makeCtx(env),
      'stripe_key',
    );
    expect(badHosts.status).toBe(400);
    await expect(badHosts.json()).resolves.toMatchObject({ param: 'allowedHosts' });

    const badMethods = await handleSecrets(
      secretsRequest('PUT', 'stripe_key', { allowedMethods: [] }),
      makeCtx(env),
      'stripe_key',
    );
    expect(badMethods.status).toBe(400);

    const badPaths = await handleSecrets(
      secretsRequest('PUT', 'stripe_key', { allowedPaths: ['../x'] }),
      makeCtx(env),
      'stripe_key',
    );
    expect(badPaths.status).toBe(400);
    await expect(badPaths.json()).resolves.toMatchObject({ code: 'INVALID_PATH_PATTERN' });
  });

  it('updates metadata and rotates existing credentials', async () => {
    const bindCaptures: Array<{ sql: string; args: unknown[] }> = [];
    const env = makeSecretsEnv({ secret: sampleSecret }, { bindCaptures });
    const response = await handleSecrets(
      secretsRequest('PUT', 'stripe_key', {
        description: 'rotated',
        allowedHosts: ['api.stripe.com', 'hooks.stripe.com'],
        allowedMethods: ['post'],
        allowedPaths: ['/v1/**'],
        injectionConfig: { prefix: 'Token ' },
        rateLimit: 120,
        credentials: { value: 'sk_new_key' },
      }),
      makeCtx(env),
      'stripe_key',
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { data: { updatedAt: string } };
    expect(body.data.updatedAt).toBe('2026-05-30T15:00:00.000Z');
    expect(bindCaptures.some((c) => c.sql.includes('UPDATE artifact_secret_credentials'))).toBe(true);
    expect(bindCaptures.some((c) => c.sql.includes('UPDATE artifact_secrets'))).toBe(true);
  });

  it('inserts credentials when secret has no credentials_id', async () => {
    const bindCaptures: Array<{ sql: string; args: unknown[] }> = [];
    const secretNoCred = { ...sampleSecret, credentials_id: null };
    const env = makeSecretsEnv({ secret: secretNoCred }, { bindCaptures });
    const response = await handleSecrets(
      secretsRequest('PUT', 'stripe_key', { credentials: { value: 'sk_first' } }),
      makeCtx(env),
      'stripe_key',
    );

    expect(response.status).toBe(200);
    expect(bindCaptures.some((c) => c.sql.includes('INSERT INTO artifact_secret_credentials'))).toBe(true);
  });
});

describe('deleteSecret', () => {
  it('returns 404 when secret is missing', async () => {
    const env = makeSecretsEnv({ secret: null });
    const response = await handleSecrets(
      secretsRequest('DELETE', 'missing'),
      makeCtx(env),
      'missing',
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: 'SECRET_NOT_FOUND' });
  });

  it('deletes secret and linked credentials', async () => {
    const bindCaptures: Array<{ sql: string; args: unknown[] }> = [];
    const env = makeSecretsEnv({ secret: sampleSecret }, { bindCaptures });
    const response = await handleSecrets(
      secretsRequest('DELETE', 'stripe_key'),
      makeCtx(env),
      'stripe_key',
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { deleted: true } });
    expect(bindCaptures.some((c) => c.sql.includes('DELETE FROM artifact_secret_credentials'))).toBe(true);
    expect(bindCaptures.some((c) => c.sql.includes('DELETE FROM artifact_secrets'))).toBe(true);
  });

  it('deletes secret without credentials row', async () => {
    const bindCaptures: Array<{ sql: string; args: unknown[] }> = [];
    const env = makeSecretsEnv(
      { secret: { ...sampleSecret, credentials_id: null } },
      { bindCaptures },
    );
    const response = await handleSecrets(
      secretsRequest('DELETE', 'stripe_key'),
      makeCtx(env),
      'stripe_key',
    );
    expect(response.status).toBe(200);
    expect(bindCaptures.some((c) => c.sql.includes('DELETE FROM artifact_secret_credentials'))).toBe(false);
  });
});

describe('getAuditLog', () => {
  it('returns paginated audit entries', async () => {
    const env = makeSecretsEnv({
      auditLogs: [{
        id: 'aud_1',
        method: 'POST',
        host: 'api.stripe.com',
        path: '/v1/charges',
        status_code: 200,
        error: null,
        execution_time_ms: 42,
        created_at: '2026-05-30T14:00:00.000Z',
      }],
    });
    const response = await handleSecrets(
      secretsRequest('GET', 'stripe_key/audit?limit=5000&offset=10'),
      makeCtx(env),
      'stripe_key/audit',
    );

    expect(response.status).toBe(200);
    const body = await response.json() as {
      data: { count: number; logs: Array<{ statusCode: number; executionTimeMs: number }> };
    };
    expect(body.data.count).toBe(1);
    expect(body.data.logs[0]).toMatchObject({ statusCode: 200, executionTimeMs: 42 });
  });
});

describe('executeProxy', () => {
  function proxySecret(overrides: Partial<SecretRow> = {}): SecretRow {
    return {
      ...sampleSecret,
      encrypted_data: encryptedSample.encrypted,
      iv: encryptedSample.iv,
      ...overrides,
    };
  }

  function proxyRequest(body: unknown) {
    return handleSecrets(
      secretsRequest('POST', 'stripe_key/proxy', body),
      makeCtx(makeSecretsEnv({ secret: proxySecret() })),
      'stripe_key/proxy',
    );
  }

  it('returns 500 when CREDENTIALS_KEY is missing', async () => {
    const env = makeSecretsEnv({ secret: proxySecret() }, { credentialsKey: null });
    const response = await handleSecrets(
      secretsRequest('POST', 'stripe_key/proxy', { path: '/v1/test' }),
      makeCtx(env),
      'stripe_key/proxy',
    );
    expect(response.status).toBe(500);
  });

  it('returns 404 when secret is missing', async () => {
    const env = makeSecretsEnv({ secret: null });
    const response = await handleSecrets(
      secretsRequest('POST', 'missing/proxy', { path: '/v1/test' }),
      makeCtx(env),
      'missing/proxy',
    );
    expect(response.status).toBe(404);
  });

  it('returns 400 for invalid JSON and missing path', async () => {
    const env = makeSecretsEnv({ secret: proxySecret() });

    const badJson = await handleSecrets(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/secrets/stripe_key/proxy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'bad',
      }),
      makeCtx(env),
      'stripe_key/proxy',
    );
    expect(badJson.status).toBe(400);

    const noPath = await handleSecrets(
      secretsRequest('POST', 'stripe_key/proxy', {}),
      makeCtx(env),
      'stripe_key/proxy',
    );
    expect(noPath.status).toBe(400);
    await expect(noPath.json()).resolves.toMatchObject({ param: 'path' });
  });

  it('rejects disallowed method, path, hosts, destination, and host', async () => {
    const base = proxySecret();

    const methodDenied = await handleSecrets(
      secretsRequest('POST', 'stripe_key/proxy', { method: 'DELETE', path: '/v1/charges' }),
      makeCtx(makeSecretsEnv({ secret: base })),
      'stripe_key/proxy',
    );
    expect(methodDenied.status).toBe(405);

    const pathDenied = await handleSecrets(
      secretsRequest('POST', 'stripe_key/proxy', { path: '/admin/users' }),
      makeCtx(makeSecretsEnv({ secret: base })),
      'stripe_key/proxy',
    );
    expect(pathDenied.status).toBe(403);
    await expect(pathDenied.json()).resolves.toMatchObject({ code: 'PATH_NOT_ALLOWED' });

    const noHosts = await handleSecrets(
      secretsRequest('POST', 'stripe_key/proxy', { path: '/v1/test' }),
      makeCtx(makeSecretsEnv({ secret: { ...base, allowed_hosts: '[]' } })),
      'stripe_key/proxy',
    );
    expect(noHosts.status).toBe(400);
    await expect(noHosts.json()).resolves.toMatchObject({ code: 'NO_HOSTS_CONFIGURED' });

    const blocked = await handleSecrets(
      secretsRequest('POST', 'stripe_key/proxy', { path: '/v1/test' }),
      makeCtx(makeSecretsEnv({
        secret: { ...base, allowed_hosts: '["localhost"]', allowed_paths: '["/**"]', allowed_methods: '["GET"]' },
      })),
      'stripe_key/proxy',
    );
    expect(blocked.status).toBe(403);
    await expect(blocked.json()).resolves.toMatchObject({ code: 'BLOCKED_DESTINATION' });

    const hostDenied = await handleSecrets(
      secretsRequest('POST', 'stripe_key/proxy', { path: '/v1/test' }),
      makeCtx(makeSecretsEnv({
        secret: {
          ...base,
          allowed_hosts: '["https://other.com/base", "api.stripe.com"]',
          allowed_paths: '["/**"]',
          allowed_methods: '["GET"]',
        },
      })),
      'stripe_key/proxy',
    );
    expect(hostDenied.status).toBe(403);
    await expect(hostDenied.json()).resolves.toMatchObject({ code: 'HOST_NOT_ALLOWED' });
  });

  it('enforces rate limits', async () => {
    const secret = proxySecret({ id: 'sec_rate', rate_limit_rpm: 1 });
    const env = makeSecretsEnv({ secret });
    const ctx = makeCtx(env);

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })));

    const first = await handleSecrets(
      secretsRequest('POST', 'stripe_key/proxy', { path: '/v1/charges' }),
      ctx,
      'stripe_key/proxy',
    );
    expect(first.status).toBe(200);

    const second = await handleSecrets(
      secretsRequest('POST', 'stripe_key/proxy', { path: '/v1/charges' }),
      ctx,
      'stripe_key/proxy',
    );
    expect(second.status).toBe(429);
    await expect(second.json()).resolves.toMatchObject({ code: 'SECRET_RATE_LIMITED' });
  });

  it('proxies JSON responses with bearer injection', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer sk_test_123');
      expect(headers['User-Agent']).toBe('ShareOut-Proxy/1.0');
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }));

    const response = await proxyRequest({
      path: 'v1/charges',
      method: 'post',
      body: { amount: 100 },
      headers: { Accept: 'application/json', 'X-Custom': 'ignored' },
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { data: { data: { ok: boolean }; status: number } };
    expect(body.data.data).toEqual({ ok: true });
    expect(body.data.status).toBe(200);
  });

  it('proxies text responses and handles fetch failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('plain-text', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })));

    const textResponse = await proxyRequest({ path: '/v1/charges' });
    expect(textResponse.status).toBe(200);
    const textBody = await textResponse.json() as { data: { data: string } };
    expect(textBody.data.data).toBe('plain-text');

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('network down');
    }));

    const failResponse = await proxyRequest({ path: '/v1/charges' });
    expect(failResponse.status).toBe(502);
    const failBody = await failResponse.json();
    expect(failBody).toMatchObject({
      code: 'PROXY_ERROR',
      error: 'Proxy request failed',
    });
    expect(JSON.stringify(failBody)).not.toContain('network down');

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('D1_ERROR: no such table');
    }));

    const internalResponse = await proxyRequest({ path: '/v1/charges' });
    expect(internalResponse.status).toBe(502);
    const internalBody = await internalResponse.json();
    expect(internalBody).toMatchObject({
      code: 'PROXY_ERROR',
      error: 'Proxy request failed',
    });
    expect(JSON.stringify(internalBody)).not.toContain('D1_ERROR');
  });

  it('supports basic, header, and query injection types', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    await handleSecrets(
      secretsRequest('POST', 'basic/proxy', { path: '/v1/test' }),
      makeCtx(makeSecretsEnv({
        secret: proxySecret({
          name: 'basic',
          injection_type: 'basic',
          allowed_methods: '["GET"]',
        }),
      })),
      'basic/proxy',
    );
    const basicHeaders = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(basicHeaders.Authorization).toMatch(/^Basic /);

    fetchMock.mockClear();
    await handleSecrets(
      secretsRequest('POST', 'header/proxy', { path: '/v1/test' }),
      makeCtx(makeSecretsEnv({
        secret: proxySecret({
          name: 'header',
          injection_type: 'header',
          injection_config: JSON.stringify({ headerName: 'X-Api-Key', prefix: 'key-' }),
          allowed_methods: '["GET"]',
        }),
      })),
      'header/proxy',
    );
    const headerHeaders = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headerHeaders['X-Api-Key']).toBe('key-sk_test_123');

    fetchMock.mockClear();
    await handleSecrets(
      secretsRequest('POST', 'query/proxy', { path: '/v1/test', query: { extra: '1' } }),
      makeCtx(makeSecretsEnv({
        secret: proxySecret({
          name: 'query',
          injection_type: 'query',
          injection_config: JSON.stringify({ queryParam: 'api_key' }),
          allowed_methods: '["GET"]',
        }),
      })),
      'query/proxy',
    );
    expect(String(fetchMock.mock.calls[0][0])).toContain('extra=1');
  });

  it('proxies without credentials when none are stored', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init?: RequestInit) => {
      expect(init?.headers).not.toHaveProperty('Authorization');
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));

    const response = await handleSecrets(
      secretsRequest('POST', 'nocred/proxy', { path: '/v1/test' }),
      makeCtx(makeSecretsEnv({
        secret: {
          ...proxySecret({ name: 'nocred', allowed_methods: '["GET"]' }),
          encrypted_data: null,
          iv: null,
        },
      })),
      'nocred/proxy',
    );
    expect(response.status).toBe(200);
  });
});
