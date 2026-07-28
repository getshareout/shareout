// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fuzzyScore, normalize } from '../../../src/search/quick-search';

describe('normalize', () => {
  it('lowercases, strips accents, collapses whitespace', () => {
    expect(normalize('  Revénue   Report ')).toBe('revenue report');
    expect(normalize('CAFÉ')).toBe('cafe');
  });
});

describe('fuzzyScore', () => {
  it('rewards exact over prefix over substring', () => {
    const exact = fuzzyScore('revenue', 'revenue');
    const prefix = fuzzyScore('rev', 'revenue report');
    const wordBoundary = fuzzyScore('report', 'revenue report');
    const mid = fuzzyScore('ven', 'revenue');
    expect(exact).toBe(1);
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(wordBoundary);
    expect(wordBoundary).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(0);
  });

  it('is typo/gap tolerant via subsequence', () => {
    expect(fuzzyScore('revnue', 'revenue report')).toBeGreaterThan(0);
    expect(fuzzyScore('rvnu', 'revenue')).toBeGreaterThan(0);
  });

  it('matches multi-token queries in any order', () => {
    expect(fuzzyScore('report revenue', 'revenue q3 report')).toBeGreaterThan(0);
  });

  it('returns 0 for no match and empty inputs', () => {
    expect(fuzzyScore('xyz', 'revenue report')).toBe(0);
    expect(fuzzyScore('', 'revenue')).toBe(0);
    expect(fuzzyScore('revenue', '')).toBe(0);
  });

  it('ranks a title hit above a buried subsequence', () => {
    const titleHit = fuzzyScore('sales', 'sales dashboard');
    const buried = fuzzyScore('sales', 'seasonal analytics ledger set'); // s..a..l..e..s subsequence
    expect(titleHit).toBeGreaterThan(buried);
  });
});
