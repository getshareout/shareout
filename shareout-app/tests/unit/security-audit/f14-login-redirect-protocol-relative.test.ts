import { describe, expect, it } from 'vitest';
import type { Env } from '../../../src/types';
import { createFetchContext } from '../../../src/router/context';
import { routeAuth } from '../../../src/router/auth-router';

const env = { DB: { prepare: () => ({ bind: () => ({ first: async () => null, all: async () => ({ results: [] }), run: async () => ({}) }) }) } } as unknown as Env;
const login = async (redirect: string) => {
  const res = (await routeAuth(createFetchContext(new Request(`https://shareout.site/auth/login?redirect=${encodeURIComponent(redirect)}`), env)))!;
  return res.text();
};

describe('f14 protocol-relative redirect on /auth/login', () => {
  it('blocks: //evil.example falls back to /home', async () => {
    const html = await login('//evil.example');
    expect(html).not.toContain('evil.example');
    expect(html).toContain('var redirectAfter = "/home";');
  });
  it('blocks: backslash variant /\\evil.example falls back to /home', async () => {
    const html = await login('/\\evil.example');
    expect(html).not.toContain('evil.example');
    expect(html).toContain('var redirectAfter = "/home";');
  });
  it('keeps a legitimate same-origin path', async () => {
    expect(await login('/a/my-page/?x=1')).toContain('var redirectAfter = "/a/my-page/?x=1";');
  });
});
