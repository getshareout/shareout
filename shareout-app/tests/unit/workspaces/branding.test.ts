import { describe, expect, it } from 'vitest';
import { parseBranding } from '../../../src/workspaces/branding';

describe('workspace branding', () => {
  it('returns defaults for null or empty input', () => {
    expect(parseBranding(null)).toEqual({
      logo_ext: null,
      accent_color: null,
      hide_footer: false,
    });
  });

  it('parses valid branding JSON', () => {
    expect(parseBranding(JSON.stringify({
      logo_ext: 'png',
      accent_color: '#1a2b3c',
      hide_footer: true,
    }))).toEqual({
      logo_ext: 'png',
      accent_color: '#1a2b3c',
      hide_footer: true,
    });
  });

  it('rejects invalid accent colors and coerces hide_footer', () => {
    expect(parseBranding(JSON.stringify({
      accent_color: 'red',
      hide_footer: 'yes',
    }))).toEqual({
      logo_ext: null,
      accent_color: null,
      hide_footer: false,
    });
  });
});
