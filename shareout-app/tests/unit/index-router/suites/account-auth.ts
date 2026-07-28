/**
 * Index router test suite: account auth.
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

export function registerAccountAuthTests(handlers: HandlerMocks): void {
describe('index router — account auth routes', () => {
  it('creates account locally without rate-limit headers', async () => {
    const response = await fetchPath('/v1/auth/create-account', {
      method: 'POST',
      headers: {
        Host: 'localhost:8787',
        'cf-connecting-ip': '127.0.0.1',
      },
      body: JSON.stringify({ email: 'new@example.com' }),
    });
    expect(await handlerTag(response)).toBe('handleCreateAccount');
    expect(handlers.checkAccountCreation).not.toHaveBeenCalled();
    expect(response.headers.get('X-RateLimit-Remaining')).toBeNull();
  });

  it('rate-limits account creation in production', async () => {
    handlers.checkAccountCreation.mockResolvedValueOnce({
      allowed: false,
      limit: 3,
      remaining: 0,
      reset: Date.now() + 60_000,
    });
    const response = await fetchPath('/v1/auth/create-account', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '203.0.113.55' },
      body: '{}',
    });
    expect(response.status).toBe(429);
    expect(handlers.rateLimitResponse).toHaveBeenCalled();
  });

  it('applies rate-limit headers on successful production signup', async () => {
    const response = await fetchPath('/v1/auth/create-account', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '203.0.113.55' },
      body: '{}',
    });
    expect(await handlerTag(response)).toBe('handleCreateAccount');
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('0');
  });

  it('requires auth for profile, link-email, and admin-session', async () => {
    for (const path of ['/v1/auth/profile', '/v1/auth/link-email', '/v1/auth/admin-session']) {
      const response = await fetchPath(path, {
        method: path.includes('profile') ? 'GET' : 'POST',
        body: path.includes('profile') ? undefined : '{}',
      });
      expect(response.status).toBe(401);
    }
  });

  it('dispatches authenticated profile routes', async () => {
    expect(await handlerTag(await fetchPath('/v1/auth/profile', authed({ method: 'GET' })))).toBe('handleGetProfile');
    expect(await handlerTag(await fetchPath('/v1/auth/profile', authed({ method: 'PUT', body: '{}' })))).toBe('handleUpdateProfile');
    expect(await handlerTag(await fetchPath('/v1/auth/profile', authed({ method: 'PATCH', body: '{}' })))).toBe('handleUpdateProfile');
    expect(await handlerTag(await fetchPath('/v1/auth/link-email', authed({ method: 'POST', body: '{}' })))).toBe('handleLinkEmail');
    expect(await handlerTag(await fetchPath('/v1/auth/admin-session', authed({ method: 'POST', body: '{}' })))).toBe('handleCreateAdminSession');
  });

  it('redirects link-google when authenticated', async () => {
    const response = await fetchPath('/v1/auth/link-google?redirect=/home', authed());
    expect(response.status).toBe(302);
    expect(handlers.handleLinkGoogleStart).toHaveBeenCalledWith('usr_1', '/home', expect.any(Object), 'identity');
  });
});
}
