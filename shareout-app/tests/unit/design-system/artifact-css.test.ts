import { describe, expect, it } from 'vitest';
import { artifactStylesheet } from '../../../src/design-system/artifact-css';
import { colors } from '../../../src/design-system/tokens';

describe('artifact stylesheet', () => {
  it('exposes brand tokens as --so- custom properties', () => {
    expect(artifactStylesheet).toContain('--so-color-primary: #2563eb');
    expect(artifactStylesheet).toContain('--so-radius-sm: 12px');
    expect(artifactStylesheet).toContain('--so-space-6: 24px');
  });

  it('emits every color token as a --so-color-* var (stays in sync with tokens.ts)', () => {
    const kebab = (s: string) =>
      s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    for (const key of Object.keys(colors)) {
      expect(artifactStylesheet).toContain(`--so-color-${kebab(key)}:`);
    }
  });

  it('ships brand component classes', () => {
    expect(artifactStylesheet).toContain('.so-btn');
    expect(artifactStylesheet).toContain('.so-card');
    expect(artifactStylesheet).toContain('.so-input');
    expect(artifactStylesheet).toContain('.so-toast');
  });

  it('loads brand fonts, not generic defaults', () => {
    expect(artifactStylesheet).toContain('Satoshi');
    expect(artifactStylesheet).not.toContain('Inter');
    expect(artifactStylesheet).not.toContain('667eea');
  });
});
