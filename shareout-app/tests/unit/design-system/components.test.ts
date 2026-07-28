// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  badgeStyles,
  buttonStyles,
  cardStyles,
  css,
  emptyStateStyles,
  headerStyles,
  inputStyles,
  statStyles,
  tableStyles,
  toastStyles,
} from '../../../src/design-system/components';
import { colors, fonts, layout, radius, spacing } from '../../../src/design-system/tokens';

describe('design-system components', () => {
  it('embeds token values in button styles', () => {
    expect(buttonStyles.primary).toContain(colors.primary);
    expect(buttonStyles.primary).toContain(colors.textInverse);
    expect(buttonStyles.primary).toContain(layout.touchTarget);
    expect(buttonStyles.secondaryHover).toContain(colors.surface);
    expect(buttonStyles.ghost).toContain(colors.textSecondary);
    expect(buttonStyles.icon).toContain(String(layout.touchTarget));
  });

  it('embeds token values in card and input styles', () => {
    expect(cardStyles.base).toContain(colors.bgElevated);
    expect(cardStyles.title).toContain(fonts.display);
    expect(cardStyles.interactiveHover).toContain(colors.borderStrong);

    expect(inputStyles.base).toContain(spacing[3]);
    expect(inputStyles.focus).toContain(colors.primaryAlpha15);
    expect(inputStyles.error).toContain(colors.error);
    expect(inputStyles.label).toContain(colors.textSecondary);
  });

  it('covers badge, toast, header, table, stat, and empty state styles', () => {
    expect(badgeStyles.primary).toContain(colors.primaryLight);
    expect(badgeStyles.success).toContain(colors.success);
    expect(badgeStyles.warning).toContain(colors.warning);
    expect(badgeStyles.error).toContain(colors.error);
    expect(badgeStyles.neutral).toContain(colors.surface);

    expect(toastStyles.container).toContain('position: fixed');
    expect(toastStyles.info).toContain(colors.primary);
    expect(toastStyles.success).toContain(colors.success);

    expect(headerStyles.base).toContain(layout.headerHeight);
    expect(headerStyles.title).toContain(fonts.display);

    expect(tableStyles.th).toContain(colors.textTertiary);
    expect(tableStyles.td).toContain(colors.text);

    expect(statStyles.value).toContain(colors.primary);
    expect(statStyles.label).toContain(colors.textSecondary);

    expect(emptyStateStyles.title).toContain(colors.text);
    expect(emptyStateStyles.text).toContain(colors.textSecondary);
  });

  it('css helper trims interpolated template strings', () => {
    const value = 42;
    expect(css`
      color: ${colors.primary};
      padding: ${value}px;
    `).toBe(`color: ${colors.primary};
      padding: 42px;`);
  });
});
