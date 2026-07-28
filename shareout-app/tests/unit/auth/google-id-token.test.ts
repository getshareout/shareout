// P0 robustness: Google ID token verify rejects bad tokens; accepts a signed JWT.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyGoogleIdToken } from '../../../src/auth/google-id-token';

function b64url(bytes: ArrayBuffer | Uint8Array | string): string {
  const u8 = typeof bytes === 'string'
    ? new TextEncoder().encode(bytes)
    : bytes instanceof Uint8Array
      ? bytes
      : new Uint8Array(bytes);
  let bin = '';
  for (const b of u8) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function mintRsaJwt(claims: Record<string, unknown>, kid: string) {
  const { privateKey, publicKey } = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const jwk = await crypto.subtle.exportKey('jwk', publicKey) as JsonWebKey & { kid?: string };
  jwk.kid = kid;
  const header = b64url(JSON.stringify({ alg: 'RS256', kid }));
  const payload = b64url(JSON.stringify(claims));
  const data = new TextEncoder().encode(`${header}.${payload}`);
  const sig = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, privateKey, data);
  return { token: `${header}.${payload}.${b64url(sig)}`, jwk };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('verifyGoogleIdToken', () => {
  it('rejects malformed credentials', async () => {
    await expect(verifyGoogleIdToken('a.b', 'client')).rejects.toThrow(/Malformed/);
    await expect(verifyGoogleIdToken('not-a-jwt', 'client')).rejects.toThrow(/Malformed/);
    // 3 segments but garbage header → still rejects
    await expect(verifyGoogleIdToken('not.a.jwt', 'client')).rejects.toThrow();
  });

  it('rejects non-RS256 algorithms', async () => {
    const header = b64url(JSON.stringify({ alg: 'none', kid: 'k' }));
    const payload = b64url(JSON.stringify({}));
    await expect(verifyGoogleIdToken(`${header}.${payload}.x`, 'client')).rejects.toThrow(/algorithm/);
  });

  it('verifies a real signed token and enforces aud/iss/exp', async () => {
    const kid = `kid_${crypto.randomUUID()}`;
    const clientId = 'shareout-client';
    const { token, jwk } = await mintRsaJwt({
      sub: 'google-sub-1',
      email: 'user@example.com',
      email_verified: true,
      name: 'User',
      aud: clientId,
      iss: 'https://accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }, kid);

    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ keys: [jwk] }),
      { headers: { 'cache-control': 'max-age=60' } },
    )));

    const claims = await verifyGoogleIdToken(token, clientId);
    expect(claims.email).toBe('user@example.com');
    expect(claims.sub).toBe('google-sub-1');

    // Wrong audience
    await expect(verifyGoogleIdToken(token, 'other-client')).rejects.toThrow(/audience/i);
  });

  it('rejects expired tokens', async () => {
    const kid = `kid_${crypto.randomUUID()}`;
    const clientId = 'c';
    const { token, jwk } = await mintRsaJwt({
      sub: 's',
      email: 'e@x.com',
      aud: clientId,
      iss: 'accounts.google.com',
      exp: Math.floor(Date.now() / 1000) - 10,
    }, kid);

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] }))));
    await expect(verifyGoogleIdToken(token, clientId)).rejects.toThrow(/Expired/);
  });

  it('rejects bad signatures', async () => {
    const kid = `kid_${crypto.randomUUID()}`;
    const clientId = 'c';
    const { token, jwk } = await mintRsaJwt({
      sub: 's', email: 'e@x.com', aud: clientId, iss: 'https://accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 60,
    }, kid);
    // Tamper payload
    const [h, , s] = token.split('.');
    const bad = `${h}.${b64url(JSON.stringify({ sub: 'evil', aud: clientId, iss: 'https://accounts.google.com', exp: 9e9 }))}.${s}`;

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] }))));
    await expect(verifyGoogleIdToken(bad, clientId)).rejects.toThrow(/signature/i);
  });
});
