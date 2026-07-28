import { describe, expect, it } from 'vitest';
import { FEATURES, FEATURE_KEYS, isKnownFeature, featureDefault } from '../../../src/features/registry';

describe('feature registry', () => {
  it('has unique, non-empty keys', () => {
    const keys = FEATURES.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const f of FEATURES) {
      expect(f.key.trim().length).toBeGreaterThan(0);
      expect(f.label.trim().length).toBeGreaterThan(0);
      expect(typeof f.defaultEnabled).toBe('boolean');
    }
  });

  it('FEATURE_KEYS matches FEATURES', () => {
    expect(FEATURE_KEYS.size).toBe(FEATURES.length);
    expect(isKnownFeature('ai.crew')).toBe(true);
    expect(isKnownFeature('nope.missing')).toBe(false);
  });

  it('featureDefault returns the registry default, fail-open for unknown', () => {
    expect(featureDefault('ai.crew')).toBe(true);
    expect(featureDefault('totally.unknown')).toBe(true);
  });
});
