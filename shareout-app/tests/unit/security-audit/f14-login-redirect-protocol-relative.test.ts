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
  it('CONFIRMS: //evil.example is kept as redirectAfter and used for window.location.href after OTP verify', async () => {
    const html = await login('//evil.example');
    expect(html).toContain('var redirectAfter = "//evil.example";');
    expect(html).toContain("window.location.href = redirectAfter || '/home';");
    expect(html).not.toContain('var redirectAfter = "/home"');
  });
  it('CONFIRMS: backslash variant /\\evil.example is also kept', async () => {
    const html = await login('/\\evil.example');
    expect(html).toContain('var redirectAfter = "/\\\\evil.example";');
  });
});
