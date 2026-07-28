// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { colors, fonts, radius, spacing, shadows, fontshareDisplayUrl, googleFontsUrl } from '../../../src/design-system/tokens';
import { standalonePageStyles } from '../../../src/design-system/standalone-page';

describe('design-system tokens', () => {
  it('matches brand color palette from Design/visual/color.md', () => {
    expect(colors.primary).toBe('#2563eb');
    expect(colors.primaryHover).toBe('#1d4ed8');
    expect(colors.primaryLight).toBe('#eff6ff');
    expect(colors.bg).toBe('#fafaf9');
    expect(colors.bgElevated).toBe('#ffffff');
    expect(colors.text).toBe('#1c1917');
    expect(colors.textSecondary).toBe('#57534e');
    expect(colors.border).toBe('#e7e5e4');
  });

  it('uses brand typography stack', () => {
    expect(fonts.display).toContain('Satoshi');
    expect(fonts.display).toContain('Instrument Sans');
    expect(fonts.body).toContain('Source Sans 3');
    expect(fonts.mono).toContain('JetBrains Mono');
    expect(fontshareDisplayUrl).toContain('fontshare.com');
    expect(fontshareDisplayUrl).toContain('satoshi');
    expect(googleFontsUrl).toContain('Source+Sans+3');
    expect(googleFontsUrl).toContain('JetBrains+Mono');
    expect(googleFontsUrl).not.toContain('Instrument+Sans');
  });

  it('uses brand radius scale (12 / 16 / 20 / 24)', () => {
    expect(radius.sm).toBe('12px');
    expect(radius.md).toBe('16px');
    expect(radius.lg).toBe('20px');
    expect(radius.xl).toBe('24px');
  });

  it('includes full spacing scale through 128px', () => {
    expect(spacing[24]).toBe('96px');
    expect(spacing[32]).toBe('128px');
  });

  it('uses warm, subtle shadows', () => {
    expect(shadows.sm).toContain('28, 25, 23');
    expect(shadows.xl).not.toContain('0.3');
  });

  it('standalone page styles use brand fonts and colors', () => {
    expect(standalonePageStyles).toContain(colors.bg);
    expect(standalonePageStyles).toContain(fonts.body);
    expect(standalonePageStyles).toContain(fonts.display);
    expect(standalonePageStyles).not.toContain('667eea');
    expect(standalonePageStyles).not.toContain('764ba2');
  });
});
