import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../src/types';
import { createOAuthState, sameOriginReturnUrl, verifyOAuthState } from '../../src/oauth-state';

const e = env as unknown as Env;
const data = { workspaceId: 'wsp_1', connectionName: 'main', returnUrl: 'https://shareout.site/home?ü=1' };

afterEach(() => vi.useRealTimers());

describe('oauth state', () => {
  it('round-trips for the same purpose and user', async () => {
    const state = await createOAuthState(e, 'p', 'usr_a', data);
    expect(await verifyOAuthState(e, state, 'p', 'usr_a')).toEqual(data);
  });

  it('rejects another user, another purpose, or no user', async () => {
    const state = await createOAuthState(e, 'p', 'usr_a', data);
    expect(await verifyOAuthState(e, state, 'p', 'usr_b')).toBeNull();
    expect(await verifyOAuthState(e, state, 'q', 'usr_a')).toBeNull();
    expect(await verifyOAuthState(e, state, 'p', null)).toBeNull();
  });

  it('rejects a tampered payload', async () => {
    const state = await createOAuthState(e, 'p', 'usr_a', data);
    const [, sig] = state.split('.');
    const forged = btoa(JSON.stringify({ p: 'p', u: 'usr_a', exp: 9e9, d: { ...data, workspaceId: 'wsp_x' } }));
    expect(await verifyOAuthState(e, `${forged}.${sig}`, 'p', 'usr_a')).toBeNull();
    expect(await verifyOAuthState(e, 'garbage', 'p', 'usr_a')).toBeNull();
  });

  it('expires after ten minutes', async () => {
    vi.useFakeTimers();
    const state = await createOAuthState(e, 'p', 'usr_a', data);
    vi.advanceTimersByTime(11 * 60 * 1000);
    expect(await verifyOAuthState(e, state, 'p', 'usr_a')).toBeNull();
  });
});

describe('sameOriginReturnUrl', () => {
  const origin = 'https://shareout.site';
  it('keeps same-origin URLs and resolves relative ones', () => {
    expect(sameOriginReturnUrl('https://shareout.site/home', origin)).toBe('https://shareout.site/home');
    expect(sameOriginReturnUrl('/home', origin)).toBe('https://shareout.site/home');
  });
  it('drops other origins, javascript:, and empty values', () => {
    expect(sameOriginReturnUrl('https://evil.example/', origin)).toBe('');
    expect(sameOriginReturnUrl('javascript:alert(1)', origin)).toBe('');
    expect(sameOriginReturnUrl('//evil.example/x', origin)).toBe('');
    expect(sameOriginReturnUrl(null, origin)).toBe('');
  });
});
