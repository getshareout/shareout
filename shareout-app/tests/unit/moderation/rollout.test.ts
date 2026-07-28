// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isUserInPublicRollout } from '../../../src/visibility-config';
import type { Env } from '../../../src/types';

const env = (over: Partial<Env>): Env => over as Env;

describe('isUserInPublicRollout', () => {
  it('is false with no rollout configured', () => {
    expect(isUserInPublicRollout(env({}), 'usr_1')).toBe(false);
  });

  it('honors the explicit allowlist', () => {
    const e = env({ PUBLIC_ROLLOUT_USERS: 'usr_a, usr_b' });
    expect(isUserInPublicRollout(e, 'usr_a')).toBe(true);
    expect(isUserInPublicRollout(e, 'usr_b')).toBe(true);
    expect(isUserInPublicRollout(e, 'usr_c')).toBe(false);
  });

  it('100% includes everyone, 0% excludes everyone', () => {
    expect(isUserInPublicRollout(env({ PUBLIC_ROLLOUT_PCT: '100' }), 'anyone')).toBe(true);
    expect(isUserInPublicRollout(env({ PUBLIC_ROLLOUT_PCT: '0' }), 'anyone')).toBe(false);
  });

  it('is deterministic for a given user (no flapping)', () => {
    const e = env({ PUBLIC_ROLLOUT_PCT: '50' });
    const first = isUserInPublicRollout(e, 'usr_stable');
    for (let i = 0; i < 5; i++) expect(isUserInPublicRollout(e, 'usr_stable')).toBe(first);
  });

  it('returns false for a null/empty user', () => {
    expect(isUserInPublicRollout(env({ PUBLIC_ROLLOUT_PCT: '100' }), null)).toBe(false);
    expect(isUserInPublicRollout(env({ PUBLIC_ROLLOUT_PCT: '100' }), '')).toBe(false);
  });

  it('clamps out-of-range / garbage percentages', () => {
    expect(isUserInPublicRollout(env({ PUBLIC_ROLLOUT_PCT: '-5' }), 'u')).toBe(false);
    expect(isUserInPublicRollout(env({ PUBLIC_ROLLOUT_PCT: 'abc' }), 'u')).toBe(false);
    expect(isUserInPublicRollout(env({ PUBLIC_ROLLOUT_PCT: '999' }), 'u')).toBe(true);
  });
});
