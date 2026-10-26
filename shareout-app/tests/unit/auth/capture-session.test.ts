import { describe, expect, it } from 'vitest';
import {
  CAPTURE_TTL_SEC,
  WRITABLE_CAPTURE_SESSION_TTL_SEC,
  isCaptureCredential,
  isCaptureLink,
  isCaptureSession,
  mintCaptureCredentials,
  mintCaptureLinkToken,
  mintCaptureSessionToken,
} from '../../../src/auth/capture-session';
import { createAccessToken, verifyAccessToken, type AccessTokenPayload } from '../../../src/token';
import type { Env } from '../../../src/types';

const env = { SESSION_SECRET: 'session-secret' } as unknown as Env;
const decode = (token: string) => JSON.parse(atob(token.split('.')[0])) as AccessTokenPayload;
const nowSec = () => Math.floor(Date.now() / 1000);

describe('capture link token', () => {
  it('lives one capture window: ten minutes', async () => {
    expect(CAPTURE_TTL_SEC).toBe(600);
    const before = nowSec();
    const link = decode(await mintCaptureLinkToken(env, 'art_1'));
    expect(link).toEqual({ artifactId: 'art_1', authType: 'capture', exp: expect.any(Number) });
    expect(link.exp).toBeGreaterThanOrEqual(before + CAPTURE_TTL_SEC);
    expect(link.exp).toBeLessThanOrEqual(nowSec() + CAPTURE_TTL_SEC);
  });
});

describe('capture page session', () => {
  it('is an identity-less owner_test read session for that one artifact', async () => {
    const linkExp = nowSec() + CAPTURE_TTL_SEC;
    const token = await mintCaptureSessionToken(env, 'art_1', { linkExp, ownerEmail: 'owner@example.com' });
    const session = decode(token);
    expect(session.authType).toBe('owner_test');
    expect(session.artifactId).toBe('art_1');
    expect(session).not.toHaveProperty('email');
    expect(session.exp).toBeLessThanOrEqual(linkExp);
    expect(session.exp).toBeGreaterThan(nowSec() + CAPTURE_TTL_SEC - 5);
    expect(isCaptureSession(session)).toBe(true);
    expect(await verifyAccessToken(token, 'art_2', env)).toBeNull();
  });

  it('never outlives the link that opened it, so reloading the link cannot extend access', async () => {
    const linkExp = nowSec() + 30;
    const session = decode(await mintCaptureSessionToken(env, 'art_1', { linkExp }));
    expect(session.exp).toBeLessThanOrEqual(linkExp);
  });

  it('is already expired when the link is', async () => {
    const linkExp = nowSec() - 1;
    const token = await mintCaptureSessionToken(env, 'art_1', { linkExp });
    expect(decode(token).exp).toBeLessThanOrEqual(linkExp);
    expect(await verifyAccessToken(token, 'art_1', env)).toBeNull();
  });

  it('writable (pilot_verify): the owner session, two minutes at most', async () => {
    const linkExp = nowSec() + 300;
    const session = decode(await mintCaptureSessionToken(env, 'art_1', { linkExp, writable: true, ownerEmail: 'owner@example.com' }));
    expect(session.authType).toBe('owner');
    expect(session.email).toBe('owner@example.com');
    expect(session.exp).toBeLessThanOrEqual(nowSec() + WRITABLE_CAPTURE_SESSION_TTL_SEC);
    expect(session.exp).toBeLessThanOrEqual(linkExp);
  });
});

describe('read-only render credentials', () => {
  it('pair a capture link with an identity-less session that ends no later than it', async () => {
    const { link, session } = await mintCaptureCredentials(env, 'art_1');
    const l = decode(link);
    const s = decode(session);
    expect(l).toMatchObject({ artifactId: 'art_1', authType: 'capture' });
    expect(s).toMatchObject({ artifactId: 'art_1', authType: 'owner_test' });
    expect(s).not.toHaveProperty('email');
    expect(s.exp).toBeLessThanOrEqual(l.exp);
    expect(isCaptureSession(s)).toBe(true);
  });
});

describe('isCaptureSession', () => {
  const at = nowSec();
  it('accepts what capture renders mint', () => {
    expect(isCaptureSession({ artifactId: 'a', authType: 'owner_test', exp: at + CAPTURE_TTL_SEC }, at)).toBe(true);
  });
  it('refuses one that carries an identity', () => {
    expect(isCaptureSession({ artifactId: 'a', authType: 'owner_test', exp: at + 60, email: 'owner@example.com' }, at)).toBe(false);
  });
  it('refuses one that would live past a capture window (the former two-hour session)', () => {
    expect(isCaptureSession({ artifactId: 'a', authType: 'owner_test', exp: at + 2 * 60 * 60 }, at)).toBe(false);
  });
  it('is only about owner_test', async () => {
    expect(isCaptureSession(decode(await createAccessToken('a', 'owner', env, 60)), at)).toBe(false);
  });
});

describe('capture credential kinds', () => {
  it('links open the capture view; sessions are read-only data tokens', () => {
    for (const t of ['capture', 'capture_test', 'capture_verify']) {
      expect(isCaptureLink(t)).toBe(true);
      expect(isCaptureCredential(t)).toBe(true);
    }
    expect(isCaptureLink('owner_test')).toBe(false);
    expect(isCaptureCredential('owner_test')).toBe(true);
    for (const t of ['password', 'cred:alice', 'owner', 'viewer', 'content']) expect(isCaptureCredential(t)).toBe(false);
  });
});
