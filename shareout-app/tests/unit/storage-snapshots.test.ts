// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { overCapBytes, bytesToGb } from '../../src/storage-snapshots';

const GB = 1_073_741_824;

describe('storage-snapshots pure helpers', () => {
  it('overCapBytes is zero under, at, or without a cap', () => {
    expect(overCapBytes(100, 200)).toBe(0);
    expect(overCapBytes(200, 200)).toBe(0);
    expect(overCapBytes(50, 0)).toBe(0);
  });

  it('overCapBytes is used - max when over', () => {
    expect(overCapBytes(300, 200)).toBe(100);
    expect(overCapBytes(3 * GB, GB)).toBe(2 * GB);
  });

  it('bytesToGb rounds to two decimals', () => {
    expect(bytesToGb(GB)).toBe(1);
    expect(bytesToGb(GB * 2.567)).toBe(2.57);
    expect(bytesToGb(0)).toBe(0);
  });
});
