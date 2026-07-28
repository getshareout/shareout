/**
 * Index router test suite: health fallthrough.
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

export function registerHealthFallthroughTests(handlers: HandlerMocks): void {
describe('index router — health, debug, and fallthrough', () => {
  it('returns health JSON with the instance origin and no warnings', async () => {
    const response = await fetchPath('/health');
    const body = await response.json() as { status: string; ts: number; origin: string; schema: string; warnings?: string[] };
    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(typeof body.ts).toBe('number');
    expect(body.origin).toBe(APEX);
    expect(body.schema).toBe('ready');
    expect(body.warnings).toBeUndefined();
  });

  // The Deploy button provisions D1 but never applies migrations, so a fresh
  // instance answers /health while every real request 500s on `no such table`.
  it('reports a missing schema on /health', async () => {
    const env = createEnv(() => { throw new Error('D1_ERROR: no such table: users'); });
    const response = await fetchPath('/health', {}, APEX, env);
    const body = await response.json() as { schema: string; warnings?: string[] };
    expect(body.schema).toBe('missing');
    expect(body.warnings?.some((w) => w.includes('migrations apply'))).toBe(true);
  });

  // Without it every agent-facing URL this instance serves names the hosted
  // instance instead, so agents publish to the wrong server. A deploy check reads
  // this rather than leaving the operator to discover it after the fact.
  it('warns on /health when SHAREOUT_BASE_URL is unset', async () => {
    const response = await fetchPath('/health', {}, APEX, createEnv(undefined, { SHAREOUT_BASE_URL: '' }));
    const body = await response.json() as { status: string; warnings?: string[] };
    expect(body.status).toBe('ok');
    expect(body.warnings?.[0]).toContain('SHAREOUT_BASE_URL is unset');
  });

  it('returns debug request introspection', async () => {
    const response = await fetchPath('/__debug/request', {
      headers: {
        Host: 'shareout.example.com',
        'cf-connecting-ip': '127.0.0.1',
      },
    });
    const body = await response.json() as { hostname: string; host: string | null };
    expect(body.hostname).toBe('shareout.example.com');
    expect(body.host).toBe('shareout.example.com');
  });

  it('returns 404 for unknown routes under a reserved namespace', async () => {
    // Unknown *site* paths now delegate to the marketing site; unknown paths
    // under a reserved product namespace keep the worker's own 404.
    const response = await fetchPath('/v1/totally-unknown-route');
    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe('Not Found');
  });

  it('returns 404 for matched path with wrong HTTP method', async () => {
    const response = await fetchPath('/v1/publish', { method: 'GET' });
    expect(response.status).toBe(404);
  });
});
}
