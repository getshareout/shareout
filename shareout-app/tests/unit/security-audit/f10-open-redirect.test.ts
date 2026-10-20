import { describe, expect, it } from 'vitest';
import type { Env } from '../../../src/types';
import { handleLogout } from '../../../src/auth/logout';
import { handleGoogleLogin } from '../../../src/auth/google-oauth';
import { safeRedirect } from '../../../src/auth/pages';

const env = { SHAREOUT_BASE_URL: 'https://shareout.site', GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec' } as unknown as Env;
const bad = ['//evil.example', '/\\evil.example', 'https://evil.example', '/\t/evil.example'];

describe('f10 open redirects', () => {
  it('safeRedirect only accepts single-slash paths', () => {
    for (const b of bad) expect(safeRedirect(b, '/x')).toBe('/x');
    expect(safeRedirect('/a/b?c=1')).toBe('/a/b?c=1');
  });

  it.each(bad)('blocks: /auth/logout?redirect=%s', async (r) => {
    const res = await handleLogout(new Request(`https://shareout.site/auth/logout?redirect=${encodeURIComponent(r)}`), env);
    expect(res.headers.get('Location')).toBe('/');
  });

  it('logout keeps a legitimate path', async () => {
    const res = await handleLogout(new Request('https://shareout.site/auth/logout?redirect=/a/x/'), env);
    expect(res.headers.get('Location')).toBe('/a/x/');
  });

  it.each(bad)('blocks: Google login state redirect %s', async (r) => {
    const res = await handleGoogleLogin(new Request(`https://shareout.site/auth/google?redirect=${encodeURIComponent(r)}`), env);
    const state = JSON.parse(atob(new URL(res.headers.get('Location')!).searchParams.get('state')!));
    expect(state.redirect).toBe('/');
  });

  it('Google login keeps a legitimate path', async () => {
    const res = await handleGoogleLogin(new Request('https://shareout.site/auth/google?redirect=/home'), env);
    expect(JSON.parse(atob(new URL(res.headers.get('Location')!).searchParams.get('state')!)).redirect).toBe('/home');
  });
});
