// @vitest-environment node
import { describe, expect, it } from 'vitest';
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
  redactUrl,
  staticHeaders,
  validateRestBaseUrl,
} from '../../../src/data/connections/rest-query';
import { CONNECTION_TYPES, CONNECTION_TIMEOUT_MS } from '../../../src/data/connections/types';

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
