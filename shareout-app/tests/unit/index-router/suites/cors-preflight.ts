/**
 * Index router test suite: cors preflight.
 * Registered from `index.test.ts` so Vitest hoists `vi.mock` in the entry file.
 */
import { describe, expect, it, vi } from 'vitest';
import type { HandlerMocks } from '../handlers';
import {
  APEX,
  SUB,
  authed,
  createEnv,
  fetchPath,
  handlerTag,
  githubState,
  sheetsState,
} from '../fixtures';

export function registerCorsPreflightTests(handlers: HandlerMocks): void {
describe('index router — CORS and preflight', () => {
  it('handles OPTIONS preflight with wildcard when no Origin', async () => {
    const response = await fetchPath('/v1/artifacts', { method: 'OPTIONS' });
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('DELETE');
  });

  it('reflects allowed apex origin with credentials', async () => {
    const response = await fetchPath('/v1/artifacts', {
      method: 'OPTIONS',
      headers: { Origin: 'https://shareout.site' },
    });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://shareout.site');
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  it('reflects allowed subdomain origin', async () => {
    const response = await fetchPath('/health', {
      method: 'OPTIONS',
      headers: { Origin: 'https://acme.shareout.site' },
    });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://acme.shareout.site');
  });

  it('reflects localhost origin', async () => {
    const response = await fetchPath('/health', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:8787' },
    });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:8787');
  });

  it('omits Allow-Origin for disallowed origins', async () => {
    const response = await fetchPath('/health', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example.com' },
    });
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('adds CORS headers to unauthorized API responses', async () => {
    const response = await fetchPath('/v1/artifacts', { method: 'GET' });
    expect(response.status).toBe(401);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
}
