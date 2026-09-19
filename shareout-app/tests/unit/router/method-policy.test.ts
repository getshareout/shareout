import { describe, expect, it } from 'vitest';
import worker from '../../../src/index';
import type { Env } from '../../../src/types';

const env = {
  SHAREOUT_BASE_URL: 'https://shareout.example.com',
  GOOGLE_CLIENT_ID: 'google-client',
  GOOGLE_CLIENT_SECRET: 'google-secret',
  SESSION_SECRET: 'session-secret',
} as unknown as Env;

async function fetchPath(path: string, init?: RequestInit): Promise<Response> {
  return worker.fetch(new Request(`https://shareout.example.com${path}`, init), env);
}

describe('method-policy', () => {
  it('returns 200 with empty body for HEAD on /health', async () => {
    const response = await fetchPath('/health', { method: 'HEAD' });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('');
  });

  it('returns 405 with Allow for GET on POST-only /v1/publish', async () => {
    const response = await fetchPath('/v1/publish', { method: 'GET' });
    const body = await response.json() as { success: false; code: string };

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('POST');
    expect(body.code).toBe('METHOD_NOT_ALLOWED');
  });
});
