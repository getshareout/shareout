/**
 * Google One Tap — verify signed ID tokens (JWT) against Google's JWKS.
 *
 * One Tap hands the browser a signed ID token instead of an auth code.
 * We verify the signature, audience, issuer, and expiry before minting
 * the same session cookie the redirect OAuth flow uses.
 */

interface GoogleIdClaims {
  sub: string;
  email: string;
  email_verified?: boolean | string;
  name?: string;
  picture?: string;
  aud: string;
  iss: string;
  exp: number;
}

let googleKeyCache: { keys: Record<string, CryptoKey>; expiresAt: number } | null = null;

async function getGoogleSigningKey(kid: string): Promise<CryptoKey> {
  const now = Date.now();
  if (!googleKeyCache || googleKeyCache.expiresAt < now || !googleKeyCache.keys[kid]) {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/certs');
    if (!res.ok) throw new Error('Failed to fetch Google signing keys');
    const jwks = await res.json<{ keys: Array<JsonWebKey & { kid: string }> }>();
    const keys: Record<string, CryptoKey> = {};
    for (const jwk of jwks.keys) {
      keys[jwk.kid] = await crypto.subtle.importKey(
        'jwk',
        jwk,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify']
      );
    }
    const maxAge = (res.headers.get('cache-control') || '').match(/max-age=(\d+)/);
    const ttl = maxAge ? parseInt(maxAge[1], 10) * 1000 : 3600_000;
    googleKeyCache = { keys, expiresAt: now + ttl };
  }
  const key = googleKeyCache.keys[kid];
  if (!key) throw new Error('Unknown signing key');
  return key;
}

function base64UrlDecode(input: string): Uint8Array {
  const pad = input.length % 4 === 0 ? '' : '='.repeat(4 - (input.length % 4));
  const bin = atob((input + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function verifyGoogleIdToken(idToken: string, clientId: string): Promise<GoogleIdClaims> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('Malformed credential');
  const [headerB64, payloadB64, sigB64] = parts;

  const header = JSON.parse(new TextDecoder().decode(base64UrlDecode(headerB64)));
  if (header.alg !== 'RS256') throw new Error('Unexpected token algorithm');

  const key = await getGoogleSigningKey(header.kid);
  const valid = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    base64UrlDecode(sigB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`)
  );
  if (!valid) throw new Error('Invalid signature');

  const claims: GoogleIdClaims = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64)));
  if (claims.aud !== clientId) throw new Error('Wrong audience');
  if (claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com') {
    throw new Error('Wrong issuer');
  }
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now()) {
    throw new Error('Expired credential');
  }
  return claims;
}

export type { GoogleIdClaims };
