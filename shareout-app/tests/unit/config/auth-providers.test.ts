import { describe, expect, it } from 'vitest';
import { googleOAuthConfigured, signInUrl } from '../../../src/config/auth-providers';
import type { Env } from '../../../src/types';

function env(partial: Partial<Env> = {}): Env {
  return partial as Env;
}

describe('googleOAuthConfigured', () => {
  it('is false when Google secrets are missing', () => {
    expect(googleOAuthConfigured(env({}))).toBe(false);
    expect(googleOAuthConfigured(env({ GOOGLE_CLIENT_ID: 'id' }))).toBe(false);
  });

  it('is true when both Google secrets are set', () => {
    expect(googleOAuthConfigured(env({
      GOOGLE_CLIENT_ID: 'id',
      GOOGLE_CLIENT_SECRET: 'secret',
    }))).toBe(true);
  });
});

describe('signInUrl', () => {
  it('points at /auth/login with redirect', () => {
    expect(signInUrl('/home')).toBe('/auth/login?redirect=%2Fhome');
  });
});
