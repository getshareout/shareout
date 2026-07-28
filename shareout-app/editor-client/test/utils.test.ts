import { describe, expect, it } from 'vitest';
import { escapeHtml, rgbToHex } from '../src/utils';

describe('rgbToHex', () => {
  it('converts rgb triplets', () => {
    expect(rgbToHex('rgb(124, 58, 237)')).toBe('#7c3aed');
  });

  it('returns white for transparent values', () => {
    expect(rgbToHex('transparent')).toBe('#ffffff');
  });
});

describe('escapeHtml', () => {
  it('escapes angle brackets, ampersands, and quotes', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'
    );
  });

  it('escapes both quote kinds so it is safe inside attributes (F22)', () => {
    // A value with a double quote can no longer break out of value="…"
    expect(escapeHtml('a" onerror="alert(1)')).toBe('a&quot; onerror=&quot;alert(1)');
    // …nor a single quote out of value='…'
    expect(escapeHtml("it's")).toBe('it&#39;s');
  });

  it('is null-safe', () => {
    expect(escapeHtml(undefined as unknown as string)).toBe('');
    expect(escapeHtml(null as unknown as string)).toBe('');
  });
});
