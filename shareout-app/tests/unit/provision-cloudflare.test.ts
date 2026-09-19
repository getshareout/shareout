// @vitest-environment node
/**
 * Pins the provision:cf R2 create classifier from the real script module.
 * Existing buckets must be loud: silent reuse shares prod artifacts.
 */
import { describe, expect, it } from 'vitest';
import { classifyR2Create } from '../../scripts/lib/r2-create-status.mjs';

describe('provision:cf R2 create classifier', () => {
  it('treats a fresh create as created', () => {
    expect(classifyR2Create('Created bucket "shareout-next-artifacts"')).toBe('created');
  });

  it('flags already-exists variants as exists (must warn, not silent success)', () => {
    expect(classifyR2Create('A bucket with the name "shareout-artifacts" already exists.')).toBe('exists');
    expect(classifyR2Create('Error: Bucket already exists')).toBe('exists');
    expect(classifyR2Create('✘ 409 Conflict')).toBe('exists');
  });

  it('surfaces real errors', () => {
    expect(classifyR2Create('✘ ERROR Authentication error')).toBe('error');
  });
});
