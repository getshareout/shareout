// @vitest-environment node
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FetchTimeoutError } from '../../../src/fetch-utils';
import {
  UpstreamHttpError,
  userFacingQueryError,
  mapMaterializeFailure,
  mapQueryFailure,
  isSafeMaterializeMessage,
} from '../../../src/data/connections/errors';
import { validateName } from '../../../src/data/connections/crud';
import {
  executeRestApiQuery,
  selfFetcher,
  redactUrl,
  staticHeaders,
  validateRestBaseUrl,
} from '../../../src/data/connections/rest-query';
import { CONNECTION_TYPES, CONNECTION_TIMEOUT_MS } from '../../../src/data/connections/types';
import { setSelfFetch } from '../../../src/http/self-fetch';

describe('connections/types', () => {
  it('exports expected connection types and timeout', () => {
    expect(CONNECTION_TYPES).toEqual(['rest_api', 'bigquery', 'snowflake']);
    expect(CONNECTION_TYPES).not.toContain('postgres');
    expect(CONNECTION_TIMEOUT_MS).toBe(15_000);
  });
});

describe('connections/crud validateName', () => {
  it('rejects empty, long, and invalid names', () => {
    expect(validateName('')).toBe('Name is required');
    expect(validateName('a'.repeat(65))).toBe('Name too long (max 64 chars)');
    expect(validateName('bad name')).toBe('Name contains invalid characters');
  });

  it('accepts valid names', () => {
    expect(validateName('my_api-v2')).toBeNull();
  });
});

describe('connections/errors', () => {
  it('maps upstream HTTP errors to safe query messages', () => {
    const err = new UpstreamHttpError(401, 'unauthorized');
    expect(userFacingQueryError(err, 'UPSTREAM_REJECTED', 401)).toContain('HTTP 401');
    expect(mapQueryFailure(err)).toEqual({
      code: 'UPSTREAM_REJECTED',
      status: 424,
      upstreamStatus: 401,
    });
  });

  it('maps timeouts to 504', () => {
    const err = new FetchTimeoutError('timeout');
    expect(mapQueryFailure(err)).toEqual({ code: 'UPSTREAM_TIMEOUT', status: 504 });
    expect(mapMaterializeFailure(err).status).toBe(504);
  });

  it('recognizes safe materialize validation messages', () => {
    expect(isSafeMaterializeMessage(new Error('Row limit exceeded (1000)'))).toBe(true);
    expect(isSafeMaterializeMessage(new Error('D1_ERROR: no such table'))).toBe(false);
  });
});

describe('connections/rest-query', () => {
  it('redacts sensitive query params in URLs', () => {
    const redacted = redactUrl('https://api.example.com/data?api_key=secret&page=1');
    expect(redacted).toContain('api_key=***');
    expect(redacted).toContain('page=1');
  });

  it('extracts string headers from config', () => {
    expect(staticHeaders({ headers: { 'X-Context': 'prod', count: 3 } })).toEqual({
      'X-Context': 'prod',
    });
  });

  it('blocks private and metadata base URLs (SSRF)', () => {
    expect(validateRestBaseUrl('http://127.0.0.1/secret')).toMatch(/Blocked/);
    expect(validateRestBaseUrl('http://169.254.169.254/latest')).toMatch(/Blocked/);
    expect(validateRestBaseUrl('https://10.0.0.5/api')).toMatch(/Blocked/);
    expect(validateRestBaseUrl('https://api.example.com/v1')).toBeNull();
    expect(validateRestBaseUrl('not-a-url')).toMatch(/absolute/);
  });

  it('re-validates redirects and drops credentials on cross-origin hops', async () => {
    const blocked = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/admin' } }),
    );
    await expect(executeRestApiQuery(
      { baseUrl: 'https://api.example.com' }, { apiKey: 'k' }, 'api_key', '/x',
    )).rejects.toThrow(/Blocked/);
    expect(blocked).toHaveBeenCalledTimes(1);
    blocked.mockRestore();

    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: 'https://other.example.net/y' } }))
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await expect(executeRestApiQuery(
      { baseUrl: 'https://api.example.com', headers: { 'X-Api-Key': 'static' } }, { apiKey: 'k' }, 'api_key', '/x',
    )).resolves.toEqual({ ok: true });
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer k');
    const hop = new Headers(fetchMock.mock.calls[1][1]?.headers);
    expect(hop.get('Authorization')).toBeNull();
    expect(hop.get('X-Api-Key')).toBeNull();
    fetchMock.mockRestore();
  });
});

const handleFetchMock = vi.fn();

describe('connections/rest-query selfFetcher', () => {
  const env = { SHAREOUT_BASE_URL: 'https://shareout.site' } as never;
  const spoof = { 'cf-connecting-ip': '127.0.0.1', 'x-forwarded-for': '127.0.0.1', 'true-client-ip': '127.0.0.1', cookie: 'a=b', host: 'localhost', Authorization: 'Bearer k', 'content-type': 'application/json' };
  beforeEach(() => setSelfFetch(handleFetchMock));
  afterAll(() => setSelfFetch(null));

  it('only intercepts the deployment\'s own host', () => {
    expect(selfFetcher(env, 'https://shareout.site/v1')).toBeTypeOf('function');
    expect(selfFetcher(env, 'https://api.example.com/v1')).toBeUndefined();
    expect(selfFetcher(env, undefined)).toBeUndefined();
  });

  it('routes /v1 calls in-worker with scrubbed headers and a non-loopback marker', async () => {
    handleFetchMock.mockReset().mockResolvedValue(new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } }));
    await expect(executeRestApiQuery(
      { baseUrl: 'https://shareout.site/v1', headers: spoof }, { apiKey: 'k' }, 'api_key', '/artifacts', undefined, selfFetcher(env, 'https://shareout.site/v1', 'usr_1'),
    )).resolves.toEqual({ ok: true });
    const req = handleFetchMock.mock.calls[0][0] as Request;
    expect(new URL(req.url).pathname).toBe('/v1/artifacts');
    expect(req.headers.get('cf-connecting-ip')).toBe('crew-self:usr_1');
    for (const h of ['x-forwarded-for', 'true-client-ip', 'cookie']) expect(req.headers.get(h)).toBeNull();
    expect(req.headers.get('host')).not.toBe('localhost');
    expect(req.headers.get('authorization')).toBe('Bearer k');
  });

  it('refuses non-/v1 paths (dev login) without reaching handleFetch', async () => {
    handleFetchMock.mockReset();
    await expect(executeRestApiQuery(
      { baseUrl: 'https://shareout.site', headers: spoof }, null, null, '/auth/dev?email=x@y.z', undefined, selfFetcher(env, 'https://shareout.site', 'usr_1'),
    )).rejects.toThrow(/only call \/v1\//);
    expect(handleFetchMock).not.toHaveBeenCalled();
  });

  it('refuses a redirect hop from /v1 to a non-/v1 self path', async () => {
    handleFetchMock.mockReset().mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: '/auth/dev?email=x@y.z' } }));
    await expect(executeRestApiQuery(
      { baseUrl: 'https://shareout.site/v1' }, { apiKey: 'k' }, 'api_key', '/redir', undefined, selfFetcher(env, 'https://shareout.site/v1', 'usr_1'),
    )).rejects.toThrow(/only call \/v1\//);
    expect(handleFetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails loudly when no entry registered the router', async () => {
    setSelfFetch(null);
    await expect(executeRestApiQuery(
      { baseUrl: 'https://shareout.site/v1' }, { apiKey: 'k' }, 'api_key', '/artifacts', undefined, selfFetcher(env, 'https://shareout.site/v1', 'usr_1'),
    )).rejects.toThrow(/no router registered/);
  });
});

describe('connections/errors mapQueryFailure', () => {
  it('maps SSRF and unsupported provider messages to client errors', () => {
    expect(mapQueryFailure(new Error('Blocked host: 127.0.0.1'))).toEqual({
      code: 'INVALID_REQUEST',
      status: 400,
    });
    expect(mapQueryFailure(new Error('Server-side query not supported for connection type "postgres". Use inline rows materialization.'))).toEqual({
      code: 'PROVIDER_NOT_IMPLEMENTED',
      status: 501,
    });
  });
});
