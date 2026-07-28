// An AES-GCM iv authenticates exactly the ciphertext it was generated for. The Sheets
// and Google OAuth token rows used to encrypt the access token and the refresh token in
// two separate calls, keep only the first iv, and then decrypt both with it — so every
// refresh token was unreadable and no token ever refreshed. These tests pin the shape
// that fixes it: one blob, one iv, both tokens inside.
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { encryptCredentials, decryptCredentials } from '../../../src/data/connections/credentials';

const KEY = 'test-credentials-key-32-chars!!';

describe('credential blobs', () => {
  it('round-trips access and refresh tokens together under one iv', async () => {
    const { encrypted, iv } = await encryptCredentials(
      { access_token: 'at_1', refresh_token: 'rt_1' },
      KEY,
    );

    const back = await decryptCredentials(encrypted, iv, KEY);

    expect(back).toEqual({ access_token: 'at_1', refresh_token: 'rt_1' });
  });

  it('cannot decrypt a second ciphertext with the first one\'s iv — the old bug', async () => {
    const first = await encryptCredentials({ token: 'access' }, KEY);
    const second = await encryptCredentials({ token: 'refresh' }, KEY);

    // Two calls, two ivs. Storing `second.encrypted` against `first.iv` is what the old
    // rows did; GCM authentication rejects it.
    expect(second.iv).not.toBe(first.iv);
    await expect(decryptCredentials(second.encrypted, first.iv, KEY)).rejects.toThrow();
  });

  it('rejects a blob encrypted under a different key rather than returning garbage', async () => {
    const { encrypted, iv } = await encryptCredentials({ access_token: 'at_1' }, KEY);

    await expect(
      decryptCredentials(encrypted, iv, 'a-completely-different-key-here'),
    ).rejects.toThrow();
  });
});
