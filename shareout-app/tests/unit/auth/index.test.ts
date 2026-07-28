import { describe, expect, it } from 'vitest';
import * as auth from '../../../src/auth';

/** Guardrail: public API surface stays stable after module decomposition. */
describe('auth module exports', () => {
  const expected = [
    'COOKIE_NAME',
    'SESSION_MAX_AGE',
    'buildSessionCookie',
    'resolveSessionMaxAge',
    'getSessionUser',
    'createSessionCookieForUser',
    'upsertUserByEmail',
    'handleGoogleLogin',
    'handleLinkGoogleStart',
    'handleGoogleCallback',
    'handleGoogleOneTap',
    'handleDevLogin',
    'handleLogout',
    'loginPage',
    'accessDeniedPage',
    'passwordLoginPage',
    'credentialsLoginPage',
    'handlePasswordAuth',
    'handleCredentialsAuth',
    'verifyAccessToken',
  ] as const;

  it.each(expected)('exports %s', (name) => {
    expect(auth).toHaveProperty(name);
    expect(typeof (auth as Record<string, unknown>)[name]).not.toBe('undefined');
  });
});
