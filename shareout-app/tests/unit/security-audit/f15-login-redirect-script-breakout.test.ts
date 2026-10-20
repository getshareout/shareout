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
  it('blocks: redirect param cannot close the inline <script>', async () => {
    const { res, html } = await login('/</script><script>window.__pwned=1</script>');
    expect(res.status).toBe(200);
    expect(html).not.toContain('window.__pwned=1</script>');
    expect(html).not.toContain('<script>window.__pwned');
    expect(html).toContain('\\u003c/script>');
  });
});
