// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { resolveSkillBucket } from '../../../scripts/lib/r2-bucket.mjs';

describe('sync:skill bucket resolution', () => {
  it('reads SKILL_R2_BUCKET from the env', () => {
    expect(resolveSkillBucket(['--changed'], { SKILL_R2_BUCKET: 'my-skill-bucket' })).toBe('my-skill-bucket');
  });

  it('prefers --bucket= over the env', () => {
    expect(resolveSkillBucket(['--bucket=flag-bucket', '--concurrency=5'], { SKILL_R2_BUCKET: 'env-bucket' })).toBe('flag-bucket');
  });

  it('throws when neither is set: no default bucket', () => {
    expect(() => resolveSkillBucket([], {})).toThrow(/No R2 bucket given/);
    expect(() => resolveSkillBucket(['--bucket='], { SKILL_R2_BUCKET: '  ' })).toThrow(/No R2 bucket given/);
  });

  it('rejects names that are not valid R2 bucket names', () => {
    expect(() => resolveSkillBucket(['--bucket=Bad_Name'], {})).toThrow(/Invalid R2 bucket name/);
    expect(() => resolveSkillBucket(['--bucket=a/../b'], {})).toThrow(/Invalid R2 bucket name/);
  });
});
