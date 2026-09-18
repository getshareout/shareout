import { describe, it, expect } from 'vitest';
import { resolveDateTokens, resolveDateTokensInParams } from '../../src/delivery/date-tokens';

const NOW = new Date('2026-08-13T09:30:00Z');

describe('resolveDateTokens', () => {
  it('resolves today, yesterday, and signed day offsets', () => {
    expect(resolveDateTokens('{{today}}', NOW)).toBe('2026-08-13');
    expect(resolveDateTokens('{{yesterday}}', NOW)).toBe('2026-08-12');
    expect(resolveDateTokens('{{date:-7d}}', NOW)).toBe('2026-08-06');
    expect(resolveDateTokens('{{date:+1d}}', NOW)).toBe('2026-08-14');
  });

  it('resolves every token in a REST path and tolerates inner whitespace', () => {
    expect(resolveDateTokens('/query/segmentation?from_date={{date:-6d}}&to_date={{ yesterday }}', NOW))
      .toBe('/query/segmentation?from_date=2026-08-07&to_date=2026-08-12');
  });

  it('crosses month and year boundaries', () => {
    expect(resolveDateTokens('{{date:-13d}}', new Date('2026-01-08T00:00:00Z'))).toBe('2025-12-26');
  });

  it('leaves untokenized text — including SQL — untouched', () => {
    const sql = 'SELECT 1 WHERE date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)';
    expect(resolveDateTokens(sql, NOW)).toBe(sql);
    expect(resolveDateTokens('{{unknown}}', NOW)).toBe('{{unknown}}');
  });
});

describe('resolveDateTokensInParams', () => {
  it('rewrites string values and preserves non-strings', () => {
    expect(resolveDateTokensInParams({ from_date: '{{date:-6d}}', unit: 'day', limit: 50 }, NOW))
      .toEqual({ from_date: '2026-08-07', unit: 'day', limit: 50 });
  });

  it('passes undefined through', () => {
    expect(resolveDateTokensInParams(undefined, NOW)).toBeUndefined();
  });
});
