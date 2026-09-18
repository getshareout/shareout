/**
 * Pins the provision:cf R2 create classifier. The script is a CLI with no exports,
 * so this duplicates classifyR2Create from scripts/provision-cloudflare.mjs — keep
 * them in sync. Existing buckets must be loud: silent reuse shares prod artifacts.
 */
import { describe, expect, it } from 'vitest';

function classifyR2Create(out: string): 'created' | 'exists' | 'error' {
  if (/Created bucket/i.test(out)) return 'created';
  if (/already exists|Bucket already|403|409/i.test(out) || /exist/i.test(out)) return 'exists';
  if (!/ERROR|✘/.test(out)) return 'created';
  return 'error';
}

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
