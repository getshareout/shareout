import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateId, sha256 } from '../../src/crypto-utils';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sha256', () => {
  it('hashes array buffers as lowercase hex', async () => {
    const data = new TextEncoder().encode('hello').buffer;

    await expect(sha256(data)).resolves.toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    );
  });

  it('hashes empty buffers to the known empty-string digest', async () => {
    await expect(sha256(new ArrayBuffer(0))).resolves.toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });

  it('returns a 64-character lowercase hex string', async () => {
    const data = new TextEncoder().encode('shareout').buffer;

    await expect(sha256(data)).resolves.toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different digests for different inputs', async () => {
    const left = new TextEncoder().encode('alpha').buffer;
    const right = new TextEncoder().encode('beta').buffer;

    await expect(sha256(left)).not.toEqual(await sha256(right));
  });
});

describe('generateId', () => {
  it('generates prefixed hex identifiers', () => {
    expect(generateId('usr')).toMatch(/^usr_[0-9a-f]{24}$/);
  });

  it('includes the prefix in the returned id', () => {
    expect(generateId('art_123')).toMatch(/^art_123_[0-9a-f]{24}$/);
  });

  it('zero-pads single-digit hex bytes', () => {
    vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
      const target = array as Uint8Array;
      target.set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      return target;
    });

    expect(generateId('blob')).toBe('blob_0102030405060708090a0b0c');
  });

  it('generates distinct ids on repeated calls', () => {
    const ids = new Set(Array.from({ length: 20 }, () => generateId('id')));

    expect(ids.size).toBe(20);
  });
});
