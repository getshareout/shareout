// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAccessToken } from '../../../src/token';
import type { DataContext } from '../../../src/data/middleware';
import type { Env } from '../../../src/types';
import { handleJsonStore } from '../../../src/data/json-store';
import { handleDataRequest } from '../../../src/data/router';

vi.mock('../../../src/crypto-utils', () => ({
  generateId: vi.fn((prefix: string) => `${prefix}_test1234567890ab`),
}));

const ARTIFACT_ID = 'art_test';
const BASE_URL = 'https://shareout.example.com';
const ORIGIN = 'https://app.example.com';

interface JsonRow {
  key: string;
  value: string;
  updated_at: string;
}

type JsonScenario = {
  keys?: { key: string }[];
  row?: JsonRow | null;
  existing?: { id: string; updated_at?: string } | null;
  keyCount?: number;
  deleteResult?: { id: string } | null;
  clearChanges?: number;
  /** meta.changes for conditional UPDATE (CAS). */
  updateChanges?: number;
};

function dbFirst(sql: string, _args: unknown[], scenario: JsonScenario): unknown {
  if (sql.includes('COUNT(*)') && sql.includes('artifact_json')) {
    return { count: scenario.keyCount ?? 0 };
  }
  if (sql.includes('SELECT id') && sql.includes('artifact_json') && !sql.includes('COUNT')) {
    return scenario.existing ?? null;
  }
  if (sql.includes('SELECT key, value')) {
    return scenario.row ?? null;
  }
  if (sql.includes('SELECT 1 FROM artifact_json')) {
    return scenario.row ? { '1': 1 } : null;
  }
  if (sql.includes('RETURNING')) {
    return scenario.deleteResult ?? null;
  }
  return null;
}

function makeJsonEnv(
  scenario: JsonScenario = {},
  options: { bindCaptures?: Array<{ sql: string; args: unknown[] }> } = {},
): Env {
  const runSpy = vi.fn(async () => ({
    success: true,
    // Prefer updateChanges for UPDATE CAS; fall back to clearChanges for DELETE ALL.
    meta: { changes: scenario.updateChanges ?? scenario.clearChanges ?? 1 },
  }));

  const DB: Record<string, unknown> = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...bindArgs: unknown[]) => {
        options.bindCaptures?.push({ sql, args: bindArgs });
        return {
          first: vi.fn(async () => dbFirst(sql, bindArgs, scenario)),
          all: vi.fn(async () => ({
            results: scenario.keys ?? [],
          })),
          run: runSpy,
        };
      }),
    })),
  };
  DB.batch = async (statements: Array<{ sql: string; bindings?: unknown[]; mode?: 'first' | 'all' | 'run' }>) => {
    const out: Array<{ result?: unknown; results?: unknown[]; meta?: { changes: number } }> = [];
    for (const s of statements) {
      const stmt = (DB.prepare as (sql: string) => { bind: (...a: unknown[]) => { first: () => Promise<unknown>; all: () => Promise<{ results: unknown[] }>; run: () => Promise<{ meta: { changes: number } }> } })(s.sql).bind(...(s.bindings ?? []));
      if (s.mode === 'first') out.push({ result: await stmt.first() });
      else if (s.mode === 'run') out.push({ meta: (await stmt.run()).meta });
      else out.push({ results: (await stmt.all()).results });
    }
    return out;
  };

  return {
    SESSION_SECRET: 'session-secret',
    DB: DB as unknown as Env['DB'],
    SHAREOUT_BASE_URL: BASE_URL,
  } as Env;
}

function makeCtx(env: Env, origin: string | null = ORIGIN): DataContext {
  return {
    artifactId: ARTIFACT_ID,
    workspaceId: 'ws_test',
    artifact: {
      id: ARTIFACT_ID,
      name: 'Test Artifact',
      visibility: 'public',
      auth_method: null,
      workspace_id: 'ws_test',
    },
    db: env.DB as unknown as DataContext['db'],
    env,
    origin,
  };
}

function jsonRequest(
  method: string,
  path: string,
  body?: unknown,
  init: RequestInit = {},
): Request {
  const headers = new Headers(init.headers ?? {});
  const url = `${BASE_URL}/v1/data/${ARTIFACT_ID}/json${path}`;
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('handleJsonStore — list and get', () => {
  it('lists keys for GET /json', async () => {
    const env = makeJsonEnv({ keys: [{ key: 'alpha' }, { key: 'beta' }] });
    const response = await handleJsonStore(
      jsonRequest('GET', ''),
      makeCtx(env),
      '',
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { keys: ['alpha', 'beta'], count: 2 },
    });
    expect(env.DB.prepare).toHaveBeenCalledWith(
      expect.stringContaining('SELECT key FROM artifact_json'),
    );
  });

  it('returns a stored value for GET /json/:key', async () => {
    const env = makeJsonEnv({
      row: {
        key: 'config',
        value: JSON.stringify({ theme: 'dark' }),
        updated_at: '2026-05-30T12:00:00.000Z',
      },
    });
    const response = await handleJsonStore(
      jsonRequest('GET', '/config'),
      makeCtx(env),
      '/config',
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        key: 'config',
        value: { theme: 'dark' },
        updatedAt: '2026-05-30T12:00:00.000Z',
      },
    });
  });

  it('returns KEY_NOT_FOUND when the key is missing', async () => {
    const env = makeJsonEnv({ row: null });
    const response = await handleJsonStore(
      jsonRequest('GET', '/missing'),
      makeCtx(env),
      '/missing',
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: 'KEY_NOT_FOUND',
    });
  });
});

describe('handleJsonStore — HEAD existence', () => {
  it('returns 200 when the key exists', async () => {
    const env = makeJsonEnv({
      row: { key: 'prefs', value: '{}', updated_at: '2026-05-30T12:00:00.000Z' },
    });
    const response = await handleJsonStore(
      jsonRequest('HEAD', '/prefs'),
      makeCtx(env),
      '/prefs',
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
  });

  it('returns 404 when the key does not exist', async () => {
    const env = makeJsonEnv({ row: null });
    const response = await handleJsonStore(
      jsonRequest('HEAD', '/prefs'),
      makeCtx(env),
      '/prefs',
    );

    expect(response.status).toBe(404);
  });

  it('returns 400 for HEAD without a key', async () => {
    const env = makeJsonEnv();
    const response = await handleJsonStore(
      jsonRequest('HEAD', ''),
      makeCtx(env),
      '',
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'MISSING_PARAM' });
  });
});

describe('handleJsonStore — set (PUT)', () => {
  it('inserts a new key and returns 201', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-30T14:00:00.000Z'));

    const binds: Array<{ sql: string; args: unknown[] }> = [];
    const env = makeJsonEnv({ existing: null, keyCount: 0 }, { bindCaptures: binds });
    const response = await handleJsonStore(
      jsonRequest('PUT', '/new_key', { enabled: true }),
      makeCtx(env),
      '/new_key',
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        key: 'new_key',
        created: true,
        updatedAt: '2026-05-30T14:00:00.000Z',
      },
    });
    expect(binds.some((b) => b.sql.includes('INSERT INTO artifact_json'))).toBe(true);
  });

  it('updates an existing key and returns 200', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-30T15:00:00.000Z'));

    const env = makeJsonEnv({
      existing: { id: 'jsn_existing', updated_at: '2026-05-30T12:00:00.000Z' },
    });
    const response = await handleJsonStore(
      jsonRequest('PUT', '/config', { theme: 'light' }),
      makeCtx(env),
      '/config',
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { key: 'config', created: false, updatedAt: '2026-05-30T15:00:00.000Z' },
    });
    expect(env.DB.prepare).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE artifact_json'),
    );
  });

  it('honors If-Match compare-and-swap on update', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-30T16:00:00.000Z'));
    const env = makeJsonEnv({
      existing: { id: 'jsn_existing', updated_at: '2026-05-30T12:00:00.000Z' },
      updateChanges: 1,
    });
    const response = await handleJsonStore(
      jsonRequest('PUT', '/counter', 2, {
        headers: { 'If-Match': '2026-05-30T12:00:00.000Z' },
      }),
      makeCtx(env),
      '/counter',
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { created: false, updatedAt: '2026-05-30T16:00:00.000Z' },
    });
  });

  it('returns VERSION_CONFLICT when If-Match is stale', async () => {
    const env = makeJsonEnv({
      existing: { id: 'jsn_existing', updated_at: '2026-05-30T12:00:00.000Z' },
    });
    const response = await handleJsonStore(
      jsonRequest('PUT', '/counter', 2, {
        headers: { 'If-Match': '2026-05-30T11:00:00.000Z' },
      }),
      makeCtx(env),
      '/counter',
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'VERSION_CONFLICT' });
  });

  it('returns VERSION_CONFLICT when If-None-Match: * and key exists', async () => {
    const env = makeJsonEnv({
      existing: { id: 'jsn_existing', updated_at: '2026-05-30T12:00:00.000Z' },
    });
    const response = await handleJsonStore(
      jsonRequest('PUT', '/counter', 1, {
        headers: { 'If-None-Match': '*' },
      }),
      makeCtx(env),
      '/counter',
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'VERSION_CONFLICT' });
  });

  it('returns KEY_INVALID for PUT with a bad key', async () => {
    const env = makeJsonEnv();
    const response = await handleJsonStore(
      jsonRequest('PUT', '/bad key!', { x: 1 }),
      makeCtx(env),
      '/bad key!',
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'KEY_INVALID' });
  });

  it('returns KEY_LIMIT_EXCEEDED when at the key cap', async () => {
    const env = makeJsonEnv({ existing: null, keyCount: 1000 });
    const response = await handleJsonStore(
      jsonRequest('PUT', '/overflow', { x: 1 }),
      makeCtx(env),
      '/overflow',
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'KEY_LIMIT_EXCEEDED' });
  });
});

describe('handleJsonStore — delete', () => {
  it('deletes a single key', async () => {
    const env = makeJsonEnv({ deleteResult: { id: 'jsn_1' } });
    const response = await handleJsonStore(
      jsonRequest('DELETE', '/config'),
      makeCtx(env),
      '/config',
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { deleted: true },
    });
  });

  it('returns KEY_INVALID when deleting with a bad key', async () => {
    const env = makeJsonEnv();
    const response = await handleJsonStore(
      jsonRequest('DELETE', '/bad key!'),
      makeCtx(env),
      '/bad key!',
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'KEY_INVALID' });
  });

  it('returns KEY_NOT_FOUND when deleting a missing key', async () => {
    const env = makeJsonEnv({ deleteResult: null });
    const response = await handleJsonStore(
      jsonRequest('DELETE', '/gone'),
      makeCtx(env),
      '/gone',
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: 'KEY_NOT_FOUND' });
  });

  it('clears all keys when DELETE has no key path', async () => {
    const env = makeJsonEnv({ clearChanges: 3 });
    const response = await handleJsonStore(
      jsonRequest('DELETE', ''),
      makeCtx(env),
      '',
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { deleted: 3 },
    });
    expect(env.DB.prepare).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM artifact_json WHERE artifact_id'),
    );
  });
});

describe('handleJsonStore — validation and routing errors', () => {
  it('rejects invalid key characters on GET', async () => {
    const env = makeJsonEnv();
    const response = await handleJsonStore(
      jsonRequest('GET', '/bad key!'),
      makeCtx(env),
      '/bad key!',
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'KEY_INVALID' });
  });

  it('returns 400 for HEAD on an invalid key without a JSON body', async () => {
    const env = makeJsonEnv();
    const response = await handleJsonStore(
      jsonRequest('HEAD', '/bad key!'),
      makeCtx(env),
      '/bad key!',
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toBe('');
  });

  it('returns MISSING_PARAM for PUT without a key', async () => {
    const env = makeJsonEnv();
    const response = await handleJsonStore(
      jsonRequest('PUT', '', { x: 1 }),
      makeCtx(env),
      '',
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'MISSING_PARAM', param: 'key' });
  });

  it('returns INVALID_JSON for malformed PUT bodies', async () => {
    const env = makeJsonEnv();
    const response = await handleJsonStore(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/json/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      }),
      makeCtx(env),
      '/config',
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'INVALID_JSON' });
  });

  it('returns VALUE_TOO_LARGE when the serialized value exceeds 1MB', async () => {
    const env = makeJsonEnv({ existing: null, keyCount: 0 });
    const response = await handleJsonStore(
      jsonRequest('PUT', '/big', { payload: 'x'.repeat(1_000_050) }),
      makeCtx(env),
      '/big',
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'VALUE_TOO_LARGE' });
  });

  it('returns METHOD_NOT_ALLOWED for unsupported verbs', async () => {
    const env = makeJsonEnv();
    const response = await handleJsonStore(
      jsonRequest('POST', '/config', { x: 1 }),
      makeCtx(env),
      '/config',
    );

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toMatchObject({ code: 'METHOD_NOT_ALLOWED' });
  });
});

describe('handleDataRequest — json permissions', () => {
  function artifactEnv(artifact: {
    id: string;
    visibility: string;
    auth_method: string | null;
  }, jsonScenario: JsonScenario = {}): Env {
    const jsonEnv = makeJsonEnv(jsonScenario);
    const prepare = vi.fn((sql: string) => {
      if (sql.includes('FROM artifacts WHERE id')) {
        return {
          bind: vi.fn(() => ({
            first: vi.fn(async () => ({
              id: artifact.id,
              name: 'Artifact',
              visibility: artifact.visibility,
              auth_method: artifact.auth_method,
              workspace_id: 'ws_test',
            })),
          })),
        };
      }
      return jsonEnv.DB.prepare(sql);
    });
    // MINIDB stub: translate the DO exec protocol back into the SQL-dispatch DB mock.
    const MINIDB = {
      idFromName: () => 'do-id',
      get: () => ({
        fetch: async (_url: string, init: RequestInit) => {
          const { sql, bindings = [], mode = 'all' } = JSON.parse(init.body as string);
          const stmt = jsonEnv.DB.prepare(sql).bind(...(bindings as unknown[]));
          if (mode === 'first') return Response.json({ result: (await stmt.first()) ?? null });
          if (mode === 'run') return Response.json({ meta: (await stmt.run()).meta });
          return Response.json({ results: (await stmt.all()).results });
        },
      }),
    };
    return { ...jsonEnv, DB: { prepare }, MINIDB } as unknown as Env;
  }

  it('returns 401 for private artifacts without credentials', async () => {
    const env = artifactEnv({
      id: ARTIFACT_ID,
      visibility: 'private',
      auth_method: 'password',
    });
    const response = await handleDataRequest(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/json`, { method: 'GET' }),
      env,
      `${ARTIFACT_ID}/json`,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  it('allows json reads when a valid access token is provided', async () => {
    const env = artifactEnv(
      { id: ARTIFACT_ID, visibility: 'private', auth_method: 'password' },
      { keys: [{ key: 'prefs' }] },
    );
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
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { keys: ['prefs'], count: 1 },
    });
  });
});
