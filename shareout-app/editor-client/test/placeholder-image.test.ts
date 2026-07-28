import { describe, it, expect } from 'vitest';
import { PLACEHOLDER_IMAGE_SRC } from '../src/palette/placeholder-image';

describe('PLACEHOLDER_IMAGE_SRC', () => {
  it('is a self-contained data-URI, not an external URL (F7 regression guard)', () => {
    // data: scheme → the browser never makes a network request for the image.
    // (The SVG's xmlns namespace contains "http" but is an identifier, never fetched.)
    expect(PLACEHOLDER_IMAGE_SRC.startsWith('data:image/svg+xml,')).toBe(true);
    expect(PLACEHOLDER_IMAGE_SRC).not.toContain('placeholder.com');
  });

  it('decodes back to valid SVG markup', () => {
    const decoded = decodeURIComponent(PLACEHOLDER_IMAGE_SRC.slice('data:image/svg+xml,'.length));
    expect(decoded).toContain('<svg');
    expect(decoded).toContain('</svg>');
  });

  it('is safe to drop into a double-quoted HTML attribute (no raw quotes)', () => {
    expect(PLACEHOLDER_IMAGE_SRC).not.toContain('"');
  });
});
