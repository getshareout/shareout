import { describe, expect, it } from 'vitest';
import {
  signPayload,
  createAccessToken,
  createSessionToken,
  extractTokenFromCookie,
  verifyAccessToken,
  verifySessionToken,
} from '../../src/token';
import type { Env } from '../../src/types';

const env = { SESSION_SECRET: 'test-secret' } as Env;

describe('session tokens', () => {
  it('creates and verifies signed session tokens', async () => {
    const token = await createSessionToken('usr_1', 'user@example.com', env);

    await expect(verifySessionToken(token, env)).resolves.toMatchObject({
      userId: 'usr_1',
      email: 'user@example.com',
    });
  });

  it('rejects malformed, tampered, and expired session tokens', async () => {
    const token = await createSessionToken('usr_1', 'user@example.com', env, -1);
    const validToken = await createSessionToken('usr_1', 'user@example.com', env);
    const [payload] = validToken.split('.');
    const tampered = `${payload}.${btoa('wrong-signature')}`;

    await expect(verifySessionToken('not-a-token', env)).resolves.toBeNull();
    await expect(verifySessionToken('.only-signature', env)).resolves.toBeNull();
    await expect(verifySessionToken(tampered, env)).resolves.toBeNull();
    await expect(verifySessionToken(token, env)).resolves.toBeNull();
    await expect(verifySessionToken(`${payload}.!!!`, env)).resolves.toBeNull();
  });

  it('rejects other tokens signed with the same secret', async () => {
    const access = await createAccessToken('art_1', 'viewer', env, 3600, 'viewer@example.com');
    await expect(verifySessionToken(access, env)).resolves.toBeNull();

    const sign = async (obj: unknown) => {
      const data = btoa(JSON.stringify(obj));
      return `${data}.${await signPayload(data, env.SESSION_SECRET)}`;
    };
    const exp = Math.floor(Date.now() / 1000) + 3600;
    await expect(verifySessionToken(await sign({ artifactId: 'art_1', userId: 'usr_1', exp }), env)).resolves.toBeNull();
    await expect(verifySessionToken(await sign({ u: 'usr_1', c: 'digest' }), env)).resolves.toBeNull();
    await expect(verifySessionToken(await sign({ email: 'a@example.com', exp }), env)).resolves.toBeNull();
    await expect(verifySessionToken(await sign({ userId: '', email: 'a@example.com', exp }), env)).resolves.toBeNull();
    await expect(verifySessionToken(await sign({ userId: 'usr_1', email: null, exp }), env)).resolves.toMatchObject({ userId: 'usr_1' });
  });
});

describe('artifact access tokens', () => {
  it('creates and verifies artifact-scoped access tokens', async () => {
    const token = await createAccessToken('art_1', 'password', env);

    await expect(verifyAccessToken(token, 'art_1', env)).resolves.toMatchObject({
      artifactId: 'art_1',
      authType: 'password',
    });
  });

  it('rejects tokens for the wrong artifact', async () => {
    const token = await createAccessToken('art_1', 'password', env);

    await expect(verifyAccessToken(token, 'art_2', env)).resolves.toBeNull();
  });

  it('rejects malformed, tampered, and expired access tokens', async () => {
    const expired = await createAccessToken('art_1', 'password', env, -1);
    const validToken = await createAccessToken('art_1', 'password', env);
    const [payload] = validToken.split('.');

    await expect(verifyAccessToken('not-a-token', 'art_1', env)).resolves.toBeNull();
    await expect(verifyAccessToken('.only-signature', 'art_1', env)).resolves.toBeNull();
    await expect(verifyAccessToken(`${payload}.${btoa('wrong-signature')}`, 'art_1', env)).resolves.toBeNull();
    await expect(verifyAccessToken(expired, 'art_1', env)).resolves.toBeNull();
    await expect(verifyAccessToken(`${payload}.!!!`, 'art_1', env)).resolves.toBeNull();
  });
});

describe('extractTokenFromCookie', () => {
  it('returns the matching cookie value', () => {
    expect(extractTokenFromCookie(
      'theme=dark; shareout_session=abc123; other=value',
      /shareout_session=([^;]+)/
    )).toBe('abc123');
  });

  it('returns null when no cookie matches', () => {
    expect(extractTokenFromCookie(null, /shareout_session=([^;]+)/)).toBeNull();
    expect(extractTokenFromCookie('theme=dark', /shareout_session=([^;]+)/)).toBeNull();
  });
});
