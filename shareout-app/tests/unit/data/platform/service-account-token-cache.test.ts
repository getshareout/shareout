// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getServiceAccountToken } from '../../../../src/data/platform/providers/bigquery/service-account';

async function newPem(): Promise<string> {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify'],
  ) as CryptoKeyPair;
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey) as ArrayBuffer);
  let bin = '';
  for (const b of der) bin += String.fromCharCode(b);
  return `-----BEGIN PRIVATE KEY-----\n${btoa(bin)}\n-----END PRIVATE KEY-----`;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('service-account token cache', () => {
  it('returns a cached token only for the same key and scope', async () => {
    let n = 0;
    const fetchMock = vi.fn(async () => Response.json({ access_token: `tok_${++n}`, expires_in: 3600 }));
    vi.stubGlobal('fetch', fetchMock);
    const email = 'reader@project-a.iam.gserviceaccount.com';
    const keyA = await newPem();
    const keyB = await newPem();

    const first = await getServiceAccountToken({ client_email: email, private_key: keyA }, 'scope-1');
    expect(await getServiceAccountToken({ client_email: email, private_key: keyA }, 'scope-1')).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const otherKey = await getServiceAccountToken({ client_email: email, private_key: keyB }, 'scope-1');
    expect(otherKey).not.toBe(first);
    const otherScope = await getServiceAccountToken({ client_email: email, private_key: keyA }, 'scope-2');
    expect(otherScope).not.toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
