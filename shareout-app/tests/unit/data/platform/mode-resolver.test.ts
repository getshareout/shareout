import { describe, expect, it } from 'vitest';
import {
  canUseDirectMode,
  getRecommendedMode,
  resolveExecutionMode,
} from '../../../../src/data/platform/execution/mode-resolver';
import type { ConnectionConfig, ProviderConfig, ProviderEndpoint } from '../../../../src/data/platform/types';

function provider(overrides: Partial<ProviderConfig['execution']> = {}): ProviderConfig {
  return {
    id: 'test-provider',
    name: 'Test',
    version: 'v1',
    execution: {
      defaultMode: 'auto',
      directSupported: true,
      proxyRequired: false,
      corsAllowed: [],
      ...overrides,
    },
    auth: { type: 'api_key', refreshable: false },
    rateLimit: { requestsPerMinute: 60, quotaTracking: 'per-artifact' },
    cache: { defaultTtlSeconds: 60, maxTtlSeconds: 300, persistable: false, userRefreshable: false },
    api: { baseUrl: 'https://api.example.com' },
    pagination: { type: 'none', defaultLimit: 100, maxLimit: 100 },
  };
}

const connection: ConnectionConfig = {
  id: 'conn_1',
  providerId: 'test-provider',
  preferredMode: 'auto',
};

describe('resolveExecutionMode', () => {
  it('forces proxy when provider or endpoint requires it', () => {
    expect(resolveExecutionMode({
      provider: provider({ proxyRequired: true }),
      endpoint: { id: 'list', method: 'GET', path: '/items' },
      connectionConfig: connection,
    })).toBe('proxy');

    expect(resolveExecutionMode({
      provider: provider(),
      endpoint: { id: 'secure', method: 'GET', path: '/secure', execution: { requiresProxy: true } },
      connectionConfig: connection,
    })).toBe('proxy');
  });

  it('honors explicit user preference when supported', () => {
    expect(resolveExecutionMode({
      provider: provider(),
      endpoint: { id: 'list', method: 'GET', path: '/items' },
      connectionConfig: connection,
      userPreference: 'direct',
    })).toBe('direct');

    expect(resolveExecutionMode({
      provider: provider({ directSupported: false }),
      endpoint: { id: 'list', method: 'GET', path: '/items' },
      connectionConfig: connection,
      userPreference: 'direct',
    })).toBe('proxy');
  });

  it('uses connection preferred mode when set', () => {
    expect(resolveExecutionMode({
      provider: provider(),
      endpoint: { id: 'list', method: 'GET', path: '/items' },
      connectionConfig: { ...connection, preferredMode: 'proxy' },
    })).toBe('proxy');
  });

  it('selects direct mode when CORS allows the request origin', () => {
    expect(resolveExecutionMode({
      provider: provider({ corsAllowed: ['https://app.example.com'] }),
      endpoint: { id: 'list', method: 'GET', path: '/items' },
      connectionConfig: connection,
      requestOrigin: 'https://app.example.com',
    })).toBe('direct');

    expect(resolveExecutionMode({
      provider: provider({ corsAllowed: ['*.example.com'] }),
      endpoint: { id: 'list', method: 'GET', path: '/items' },
      connectionConfig: connection,
      requestOrigin: 'https://reports.example.com',
    })).toBe('direct');
  });

  it('falls back to proxy when the request origin is not CORS-allowed', () => {
    expect(resolveExecutionMode({
      provider: provider({ corsAllowed: ['https://allowed.example.com'] }),
      endpoint: { id: 'list', method: 'GET', path: '/items' },
      connectionConfig: connection,
      requestOrigin: 'https://blocked.example.com',
    })).toBe('proxy');
  });

  it('uses direct mode when CORS allowlist is empty and direct is supported', () => {
    expect(resolveExecutionMode({
      provider: provider({ defaultMode: 'proxy', corsAllowed: [] }),
      endpoint: { id: 'list', method: 'GET', path: '/items' },
      connectionConfig: connection,
    })).toBe('direct');
  });
});

describe('canUseDirectMode', () => {
  it('returns false when proxy is required or direct is unsupported', () => {
    expect(canUseDirectMode(provider({ proxyRequired: true }))).toBe(false);
    expect(canUseDirectMode(provider({ directSupported: false }))).toBe(false);
    expect(canUseDirectMode(
      provider(),
      { id: 'secure', method: 'GET', path: '/secure', execution: { requiresProxy: true } } as ProviderEndpoint
    )).toBe(false);
  });
});

describe('getRecommendedMode', () => {
  it('recommends proxy or direct based on provider capabilities', () => {
    expect(getRecommendedMode(provider({ proxyRequired: true }))).toBe('proxy');
    expect(getRecommendedMode(provider({ directSupported: true }))).toBe('direct');
    expect(getRecommendedMode(provider({
      directSupported: false,
      defaultMode: 'proxy',
    }))).toBe('proxy');
  });
});
