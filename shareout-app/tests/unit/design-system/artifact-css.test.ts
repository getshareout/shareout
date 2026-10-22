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

  describe('accessibility', () => {
    const lum = (hex: string) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const ratio = (a: string, b: string) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const colorOf = (selector: string): string => {
      const rule = artifactStylesheet.split('\n').find((l) => l.startsWith(selector));
      return /color: var\(--so-color-([a-z-]+)\)\s*;?\s*}?$/.exec(rule || '')?.[1] ?? '';
    };
    const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
    const hexOf = (kebabName: string) => {
      const key = Object.keys(colors).find((k) => kebab(k) === kebabName)!;
      return (colors as Record<string, string>)[key];
    };

    it('hint text and table headers meet WCAG AA (4.5:1) on the page background', () => {
      for (const sel of ['.so-hint', '.so-table th']) {
        const token = colorOf(sel);
        expect(token, sel).not.toBe('');
        expect(ratio(hexOf(token), colors.bg), `${sel} uses ${token}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it('draws a visible token-based focus ring for keyboard users, including text inputs', () => {
      expect(artifactStylesheet).toMatch(/:focus-visible\s*{[^}]*outline: 2px solid var\(--so-color-primary\)/);
      expect(artifactStylesheet).toMatch(/\.so-input:focus-visible[^{]*{[^}]*outline: 2px solid var\(--so-color-primary\)/);
    });
  });
});
