import { describe, expect, it } from 'vitest';
import type { Env } from '../../../src/types';
import { createFetchContext } from '../../../src/router/context';
import { routeAuth } from '../../../src/router/auth-router';

const env = { DB: { prepare: () => ({ bind: () => ({ first: async () => null, all: async () => ({ results: [] }), run: async () => ({}) }) }) } } as unknown as Env;
const login = async (redirect: string) => {
  const res = (await routeAuth(createFetchContext(new Request(`https://shareout.site/auth/login?redirect=${encodeURIComponent(redirect)}`), env)))!;
  return { res, html: await res.text() };
};

describe('f15 reflected script injection on /auth/login', () => {
  it('CONFIRMS: redirect param closes the inline <script> and injects a new one', async () => {
    const payload = '/</script><script>window.__pwned=1</script>';
    const { res, html } = await login(payload);
    expect(res.status).toBe(200);
    expect(html).toContain('</script><script>window.__pwned=1</script>');
    // the breakout sits inside the password-login script's encodeURIComponent(...) call
    expect(html).toMatch(/encodeURIComponent\("\/<\/script><script>window\.__pwned=1<\/script>"\)/);
    // no CSP on the response
    expect(res.headers.get('Content-Security-Policy')).toBeNull();
  });
});
