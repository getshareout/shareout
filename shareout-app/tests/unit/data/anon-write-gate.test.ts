// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { computeWriteCapability } from '../../../src/data/middleware';
import {
  shouldBlockAnonWrite,
  ANON_WRITE_GATED_TIERS,
  MUTATING_METHODS,
} from '../../../src/data/router';

// Workstream A: read-only-default backend. These tests enumerate the gate so a
// future mutation route can't silently slip past it.

describe('computeWriteCapability', () => {
  it('blocks anonymous writes on a public artifact by default', () => {
    expect(computeWriteCapability('public', false, 0, 0)).toEqual({
      canWrite: false,
      canWriteCollab: false,
    });
  });

  it('allows the owner to write their own public artifact', () => {
    expect(computeWriteCapability('public', true, 0, 0)).toEqual({
      canWrite: true,
      canWriteCollab: true,
    });
  });

  it('honors the per-artifact anon opt-ins independently', () => {
    expect(computeWriteCapability('public', false, 1, 0)).toEqual({
      canWrite: true,
      canWriteCollab: false,
    });
    expect(computeWriteCapability('public', false, 0, 1)).toEqual({
      canWrite: false,
      canWriteCollab: true,
    });
  });

  it('never gates non-public artifacts (handler/access-policy governs)', () => {
    for (const vis of ['private', 'workspace']) {
      expect(computeWriteCapability(vis, false, 0, 0)).toEqual({
        canWrite: true,
        canWriteCollab: true,
      });
    }
  });
});

describe('shouldBlockAnonWrite — every gated store, every mutating method', () => {
  for (const tier of ANON_WRITE_GATED_TIERS) {
    for (const method of MUTATING_METHODS) {
      it(`blocks anon ${method} ${tier} when canWrite is not true`, () => {
        expect(shouldBlockAnonWrite(tier, method, false)).toBe(true);
        expect(shouldBlockAnonWrite(tier, method, undefined)).toBe(true);
      });
      it(`allows ${method} ${tier} once canWrite is granted`, () => {
        expect(shouldBlockAnonWrite(tier, method, true)).toBe(false);
      });
    }
    it(`never blocks GET/HEAD on ${tier} (reads stay public)`, () => {
      expect(shouldBlockAnonWrite(tier, 'GET', false)).toBe(false);
      expect(shouldBlockAnonWrite(tier, 'HEAD', false)).toBe(false);
    });
  }

  it('does not gate tiers with their own auth (comments/workspace/secrets/...)', () => {
    for (const tier of ['comments', 'workspace', 'sheets', 'secrets', 'connections', 'platform']) {
      expect(shouldBlockAnonWrite(tier, 'POST', false)).toBe(false);
    }
  });

  it('the gated set is exactly the four unguarded private stores', () => {
    expect([...ANON_WRITE_GATED_TIERS].sort()).toEqual(['blobs', 'datasets', 'json', 'tables']);
  });
});
