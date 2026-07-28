import { describe, expect, it } from 'vitest';
import { createUnsubscribeToken, verifyUnsubscribeToken, unsubscribeUrl } from '../../src/email/unsubscribe-token';

const env = { SESSION_SECRET: 'test-secret', SHAREOUT_BASE_URL: 'https://shareout.site' } as any;

describe('unsubscribe token', () => {
  it('round-trips user + category', async () => {
    const token = await createUnsubscribeToken(env, 'user_42', 'marketing');
    expect(await verifyUnsubscribeToken(env, token)).toEqual({ userId: 'user_42', category: 'marketing' });
  });

  it('rejects a tampered token', async () => {
    const token = await createUnsubscribeToken(env, 'user_42', 'marketing');
    const tampered = token.slice(0, -2) + (token.endsWith('a') ? 'bb' : 'aa');
    expect(await verifyUnsubscribeToken(env, tampered)).toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await createUnsubscribeToken(env, 'user_42', 'product');
    expect(await verifyUnsubscribeToken({ ...env, SESSION_SECRET: 'other' }, token)).toBeNull();
  });

  it('builds an absolute unsubscribe URL', async () => {
    const url = await unsubscribeUrl(env, 'user_42', 'commercial');
    expect(url.startsWith('https://shareout.site/v1/email/unsubscribe?token=')).toBe(true);
  });
});
