// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../../../src/data/platform';
import { getProvider } from '../../../../src/data/platform/registry';
import {
  humandAuthHeader,
  humandNextPage,
  humandPathParamError,
  humandProvider,
  humandValidationMessage,
  parseHumandRateLimit,
} from '../../../../src/data/platform/providers/humand';
import { PlatformEngine } from '../../../../src/data/platform/core/engine';
import { cleanupRateLimiters } from '../../../../src/data/platform/core/rate-limiter';
import * as credentialsModule from '../../../../src/data/platform/core/credentials';
import { PLATFORM_ERRORS, type DecryptedCredentials, type ExecutionContext, type ProviderEndpoint } from '../../../../src/data/platform/types';
import { ARTIFACT_ID, encryptTestCredentials, publicArtifactEnv } from './helpers';

const API = 'https://api-prod.humand.co/public/api/v1';
const KEY: DecryptedCredentials = { access_token: 'hk_test_key' };

function ctx(credentials: DecryptedCredentials = KEY): ExecutionContext {
  return {
    artifactId: 'art_1',
    connectionId: 'conn_1',
    connectionConfig: { id: 'conn_1', name: 'humand', provider: 'humand', preferredMode: 'proxy', config: {}, createdAt: '', updatedAt: '' },
    credentials,
    env: publicArtifactEnv(),
  };
}

function mockFetch(...responses: Response[]) {
  const calls: Request[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(input instanceof Request ? input : new Request(String(input), init));
    const r = responses.shift();
    if (!r) throw new Error('unexpected fetch');
    return r;
  });
  return calls;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const endpoint = (id: string) => humandProvider.getEndpoint(id)!;

afterEach(() => {
  vi.restoreAllMocks();
  cleanupRateLimiters();
});

describe('Humand registration', () => {
  it('is in the connectors catalog as a pasted-key, testable People & HR connector', () => {
    expect(getProvider('humand')).toBe(humandProvider);
    expect(humandProvider.config.display).toMatchObject({ category: 'people', connectMethod: 'token', testable: true });
    expect(humandProvider.requiresProxy()).toBe(true);
  });
});

describe('Humand is read-only', () => {
  it('lists only GET endpoints, and none of the write, chat or API-key endpoints', () => {
    const endpoints = humandProvider.listEndpoints();
    expect(endpoints.length).toBeGreaterThan(30);
    expect(endpoints.every((e) => e.method === 'GET')).toBe(true);
    const paths = endpoints.map((e) => e.path);
    for (const p of paths) expect(p).not.toMatch(/chats|api-keys|signed-url|deactivate|password-reset/);
    for (const id of ['users.create', 'users.upsert', 'users.delete', 'posts.create', 'documents.create', 'apiKeys.rotate', 'chats.list']) {
      expect(humandProvider.getEndpoint(id), id).toBeUndefined();
    }
  });

  it('refuses a non-GET or unlisted endpoint without calling Humand', async () => {
    const calls = mockFetch();
    const forged: ProviderEndpoint = { id: 'users.list', method: 'POST', path: '/users' };
    const unlisted: ProviderEndpoint = { id: 'users.list', method: 'GET', path: '/api-keys/allowed-ips' };
    for (const e of [forged, unlisted]) {
      const res = await humandProvider.executeRequest(ctx(), e, {});
      expect(res.success).toBe(false);
      expect(res.error?.code).toBe('HUMAND_READ_ONLY');
    }
    expect(calls).toHaveLength(0);
  });

  it('rejects missing and dot-segment path params, so a URL cannot climb to another path', async () => {
    const calls = mockFetch();
    expect(humandPathParamError('/departments/{id}/members', { id: '..' })).toBe('Invalid path parameter: id');
    expect(humandPathParamError('/departments/{id}', {})).toBe('Missing path parameter: id');
    expect(humandPathParamError('/departments/{id}', { id: 12 })).toBeNull();
    const res = await humandProvider.executeRequest(ctx(), endpoint('departments.members'), { pathParams: { id: '..' } });
    expect(res.error?.code).toBe('INVALID_PATH_PARAM');
    expect(calls).toHaveLength(0);
  });

  it('answers a write endpoint id with ENDPOINT_NOT_FOUND through the engine', async () => {
    const { encrypted, iv } = await encryptTestCredentials(KEY);
    vi.spyOn(credentialsModule, 'loadConnection').mockResolvedValue({
      id: 'conn_1', name: 'humand', provider: 'humand', preferredMode: 'proxy', config: {},
      createdAt: '', updatedAt: '', encryptedCredentials: encrypted, iv,
    });
    const calls = mockFetch();
    const result = await new PlatformEngine({ artifactId: ARTIFACT_ID, env: publicArtifactEnv() })
      .execute({ provider: 'humand', endpoint: 'users.create', connectionId: 'conn_1', params: { body: { firstName: 'x' } } });
    expect(result.error?.code).toBe(PLATFORM_ERRORS.ENDPOINT_NOT_FOUND.code);
    expect(calls).toHaveLength(0);
  });
});

describe('Humand requests', () => {
  it('reads users under /public/api/v1 with the Basic API key, query params, pagination and rate limit', async () => {
    const calls = mockFetch(json({ count: 25, users: [{ employeeInternalId: '1' }] }, 200, { RateLimit: 'limit=100, remaining=97, reset=42' }));
    const res = await humandProvider.executeRequest(ctx(), endpoint('users.list'), { queryParams: { page: 1, limit: 10, search: 'ana' } });
    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toBe(`${API}/users?page=1&limit=10&search=ana`);
    expect(calls[0].headers.get('Authorization')).toBe('Basic hk_test_key');
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ count: 25, users: [{ employeeInternalId: '1' }] });
    expect(res.pagination).toEqual({ hasMore: true, cursor: '2', total: 25 });
    expect(res.rateLimit).toMatchObject({ limit: 100, remaining: 97 });
  });

  it('fills path params into the URL', async () => {
    const calls = mockFetch(json({ items: [] }));
    await humandProvider.executeRequest(ctx(), endpoint('courses.usersProgress'), { pathParams: { courseId: 7 }, queryParams: { limit: 50 } });
    expect(calls[0].url).toBe(`${API}/courses/7/users-progress?page=1&limit=50`);
  });

  it('accepts a key pasted with the "Basic " prefix', async () => {
    expect(humandAuthHeader('  Basic abc ')).toBe('Basic abc');
    expect(humandAuthHeader('abc')).toBe('Basic abc');
    const calls = mockFetch(json({}));
    await humandProvider.executeRequest(ctx({ access_token: 'basic hk_test_key' }), endpoint('users.me'), {});
    expect(calls[0].headers.get('Authorization')).toBe('Basic hk_test_key');
  });

  it('sends page=1&limit=10 on paged lists that omit them (job positions 400 without), and nothing extra elsewhere', async () => {
    const calls = mockFetch(json({ items: [] }), json({}));
    await humandProvider.executeRequest(ctx(), endpoint('jobPositions.list'), {});
    await humandProvider.executeRequest(ctx(), endpoint('segmentations.list'), {});
    expect(calls[0].url).toBe(`${API}/job-positions?page=1&limit=10`);
    expect(calls[1].url).toBe(`${API}/segmentations`);
  });

  it('passes on Humand validation messages for a 400, and nothing else from the body', async () => {
    mockFetch(json([{ isDefined: 'employeeId should not be null or undefined' }, { isDefined: 'startDate should not be null or undefined' }], 400));
    const res = await humandProvider.executeRequest(ctx(), endpoint('timeTracking.entries'), {});
    expect(res.error).toEqual({
      code: 'HUMAND_400',
      message: 'Humand rejected the request: employeeId should not be null or undefined; startDate should not be null or undefined',
    });
    expect(await humandValidationMessage(json({ message: 'stack trace…' }, 400))).toBeNull();
    expect(await humandValidationMessage(new Response('<html>', { status: 400 }))).toBeNull();
  });

  it('turns a rejected key into a plain message and never echoes the upstream body', async () => {
    mockFetch(json({ message: 'internal detail hk_test_key' }, 401));
    const res = await humandProvider.executeRequest(ctx(), endpoint('departments.list'), {});
    expect(res).toMatchObject({ success: false, status: 401, error: { code: 'HUMAND_401', message: 'API key rejected by Humand' } });
    expect(JSON.stringify(res.error)).not.toContain('internal detail');
  });

  it('reads through the engine with a stored connection', async () => {
    const { encrypted, iv } = await encryptTestCredentials(KEY);
    vi.spyOn(credentialsModule, 'loadConnection').mockResolvedValue({
      id: 'conn_1', name: 'humand', provider: 'humand', preferredMode: 'proxy', config: {},
      createdAt: '', updatedAt: '', encryptedCredentials: encrypted, iv,
    });
    const calls = mockFetch(json({ page: 1, totalPages: 1, count: 2, items: [{ id: 1 }, { id: 2 }] }));
    const result = await new PlatformEngine({ artifactId: ARTIFACT_ID, env: publicArtifactEnv() })
      .execute({ provider: 'humand', endpoint: 'timeOff.requests', connectionId: 'conn_1', params: { queryParams: { fromDate: '2026-11-01' } } });
    expect(result.success).toBe(true);
    expect(result.data).toMatchObject({ count: 2 });
    expect(calls[0].url).toBe(`${API}/time-off/requests?page=1&limit=10&fromDate=2026-11-01`);
    expect(calls[0].headers.get('Authorization')).toBe('Basic hk_test_key');
  });
});

describe('Humand verify (Test button)', () => {
  it('passes on a 200 from /users/me', async () => {
    const calls = mockFetch(json({ id: 1 }));
    const res = await humandProvider.verifyConnection!(publicArtifactEnv(), {}, KEY);
    expect(res).toEqual({ ok: true, message: 'Connected to Humand (read-only)' });
    expect(calls[0].url).toBe(`${API}/users/me`);
  });

  it('fails on a rejected key, a rate-limited key and a missing key', async () => {
    mockFetch(json({}, 401), json({}, 429));
    expect(await humandProvider.verifyConnection!(publicArtifactEnv(), {}, KEY)).toEqual({ ok: false, message: 'API key rejected by Humand' });
    expect((await humandProvider.verifyConnection!(publicArtifactEnv(), {}, KEY)).message).toMatch(/rate limiting/);
    expect(await humandProvider.verifyConnection!(publicArtifactEnv(), {}, { access_token: ' ' })).toEqual({ ok: false, message: 'API key is required' });
  });
});

describe('Humand parsing', () => {
  it('pages from { page, totalPages } or from { count } plus the requested page', () => {
    expect(humandNextPage({ page: 2, totalPages: 3, count: 30 })).toEqual({ hasMore: true, cursor: '3', total: 30 });
    expect(humandNextPage({ page: 3, totalPages: 3, count: 30 })).toEqual({ hasMore: false, cursor: undefined, total: 30 });
    expect(humandNextPage({ count: 30, users: [] }, { page: 3, limit: 10 })).toEqual({ hasMore: false, cursor: undefined, total: 30 });
    expect(humandNextPage({ items: [] })).toBeNull();
    expect(humandNextPage([1, 2])).toBeNull();
  });

  it('reads the RateLimit header', () => {
    expect(parseHumandRateLimit('limit=100, remaining=45, reset=30', 1_000)).toEqual({ limit: 100, remaining: 45, resetAt: 31_000 });
    expect(parseHumandRateLimit(null)).toBeNull();
    expect(parseHumandRateLimit('garbage')).toBeNull();
  });
});
