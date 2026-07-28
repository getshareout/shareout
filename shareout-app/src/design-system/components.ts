/**
 * ShareOut Design System - Component Styles
 * Reusable CSS snippets for common components.
 *
 * The class-based component library (Button/Modal/Field/Card/Toast/Badge) lives
 * in ./components/ and is re-exported here so a single import path
 * ('../design-system/components') exposes both the legacy style-string objects
 * below and the new class-based helpers.
 */

import { colors, fonts, spacing, radius, shadows, animation, layout } from './tokens';

export * from './components/index';

// =============================================================================
// BUTTONS
// =============================================================================

export const buttonStyles = {
  // Primary button (main CTA)
  primary: `
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: ${spacing[2]};
    padding: 14px 28px;
    min-height: ${layout.touchTarget};
    border-radius: ${radius.sm};
    border: none;
    background: ${colors.primary};
    color: ${colors.textInverse};
    font: 600 16px ${fonts.body};
    text-decoration: none;
    cursor: pointer;
    transition: transform ${animation.durationFast} ${animation.easeOut},
                background ${animation.durationNormal} ${animation.easeOut};
  `,
  primaryHover: `
    background: ${colors.primaryHover};
    transform: translateY(-1px);
  `,
  primaryActive: `
    transform: translateY(0) scale(0.98);
  `,

  // Secondary button (outline)
  secondary: `
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: ${spacing[2]};
    padding: 14px 28px;
    min-height: ${layout.touchTarget};
    border-radius: ${radius.sm};
    border: 1px solid ${colors.border};
    background: ${colors.bgElevated};
    color: ${colors.text};
    font: 500 16px ${fonts.body};
    cursor: pointer;
    transition: all ${animation.durationNormal} ${animation.easeOut};
  `,
  secondaryHover: `
    border-color: ${colors.borderStrong};
    background: ${colors.surface};
  `,

  // Ghost button (text only)
  ghost: `
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: ${spacing[2]};
    padding: ${spacing[3]} ${spacing[4]};
    min-height: ${layout.touchTargetMin};
    border-radius: ${radius.sm};
    border: none;
    background: transparent;
    color: ${colors.textSecondary};
    font: 500 15px ${fonts.body};
    cursor: pointer;
    transition: all ${animation.durationNormal} ${animation.easeOut};
  `,
  ghostHover: `
    background: ${colors.surface};
    color: ${colors.text};
  `,

  // Icon button
  icon: `
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: ${layout.touchTarget};
    height: ${layout.touchTarget};
    border-radius: ${radius.sm};
    border: none;
    background: transparent;
    color: ${colors.textSecondary};
    cursor: pointer;
    transition: all ${animation.durationNormal} ${animation.easeOut};
  `,
  iconHover: `
    background: ${colors.surface};
    color: ${colors.text};
  `,
};

// =============================================================================
// CARDS
// =============================================================================

export const cardStyles = {
  base: `
    background: ${colors.bgElevated};
    border-radius: ${radius.md};
    border: 1px solid ${colors.border};
    padding: ${spacing[6]};
    box-shadow: ${shadows.sm};
  `,
  header: `
    margin-bottom: ${spacing[5]};
  `,
  title: `
    font: 600 18px ${fonts.display};
    color: ${colors.text};
  `,
  interactive: `
    cursor: pointer;
    transition: all ${animation.durationNormal} ${animation.easeOut};
  `,
  interactiveHover: `
    border-color: ${colors.borderStrong};
    box-shadow: ${shadows.md};
    transform: translateY(-2px);
  `,
};

// =============================================================================
// INPUTS
// =============================================================================

export const inputStyles = {
  base: `
    width: 100%;
    padding: ${spacing[3]} ${spacing[4]};
    min-height: ${layout.touchTarget};
    border-radius: ${radius.sm};
    border: 1px solid ${colors.border};
    background: ${colors.bgElevated};
    color: ${colors.text};
    font: 400 16px ${fonts.body};
    transition: all ${animation.durationNormal} ${animation.easeOut};
  `,
  focus: `
    border-color: ${colors.primary};
    box-shadow: 0 0 0 3px ${colors.primaryAlpha15};
    outline: none;
  `,
  error: `
    border-color: ${colors.error};
    box-shadow: 0 0 0 3px ${colors.errorLight};
  `,
  label: `
    display: block;
    margin-bottom: ${spacing[2]};
    font: 500 14px ${fonts.body};
    color: ${colors.textSecondary};
  `,
  hint: `
    margin-top: ${spacing[2]};
    font: 400 13px ${fonts.body};
    color: ${colors.textTertiary};
  `,
  errorMessage: `
    margin-top: ${spacing[2]};
    font: 400 13px ${fonts.body};
    color: ${colors.error};
  `,
};

// =============================================================================
// BADGES
// =============================================================================

export const badgeStyles = {
  base: `
    display: inline-flex;
    align-items: center;
    padding: ${spacing[1]} ${spacing[3]};
    border-radius: ${radius.full};
    font: 500 13px ${fonts.body};
  `,
  primary: `
    background: ${colors.primaryLight};
    color: ${colors.primary};
  `,
  success: `
    background: ${colors.successLight};
    color: ${colors.success};
  `,
  warning: `
    background: ${colors.warningLight};
    color: ${colors.warning};
  `,
  error: `
    background: ${colors.errorLight};
    color: ${colors.error};
  `,
  neutral: `
    background: ${colors.surface};
    color: ${colors.textSecondary};
  `,
};

// =============================================================================
// TOAST
// =============================================================================

export const toastStyles = {
  container: `
    position: fixed;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 10000;
    display: flex;
    flex-direction: column;
    gap: ${spacing[3]};
  `,
  base: `
    padding: 14px 20px;
    border-radius: ${radius.lg};
    font: 500 15px ${fonts.body};
    color: ${colors.textInverse};
    box-shadow: ${shadows.lg};
    min-height: ${layout.touchTarget};
    display: flex;
    align-items: center;
  `,
  info: `background: ${colors.primary};`,
  success: `background: ${colors.success};`,
  warning: `background: ${colors.warning};`,
  error: `background: ${colors.error};`,
};

// =============================================================================
// HEADER
// =============================================================================

export const headerStyles = {
  base: `
    position: sticky;
    top: 0;
    z-index: 100;
    height: ${layout.headerHeight};
    padding: 0 ${spacing[6]};
    background: ${colors.bgElevated};
    border-bottom: 1px solid ${colors.border};
    display: flex;
    align-items: center;
    justify-content: space-between;
  `,
  title: `
    font: 700 20px ${fonts.display};
    color: ${colors.text};
  `,
};

// =============================================================================
// EMPTY STATE
// =============================================================================

export const emptyStateStyles = {
  container: `
    text-align: center;
    padding: ${spacing[10]} ${spacing[6]};
  `,
  title: `
    font: 600 18px ${fonts.display};
    color: ${colors.text};
    margin-bottom: ${spacing[2]};
  `,
  text: `
    font: 400 15px ${fonts.body};
    color: ${colors.textSecondary};
  `,
};

// =============================================================================
// TABLE
// =============================================================================

export const tableStyles = {
  base: `
    width: 100%;
    border-collapse: collapse;
  `,
  th: `
    padding: ${spacing[4]} ${spacing[3]};
    text-align: left;
    border-bottom: 1px solid ${colors.border};
    font: 500 14px ${fonts.body};
    color: ${colors.textTertiary};
  `,
  td: `
    padding: ${spacing[4]} ${spacing[3]};
    text-align: left;
    border-bottom: 1px solid ${colors.border};
    font: 400 15px ${fonts.body};
    color: ${colors.text};
  `,
};

// =============================================================================
// STAT
// =============================================================================

export const statStyles = {
  container: `
    background: ${colors.surface};
    border-radius: ${radius.md};
    padding: ${spacing[5]};
    text-align: center;
  `,
  value: `
    font: 700 28px ${fonts.display};
    color: ${colors.primary};
    line-height: 1.2;
  `,
  label: `
    font: 500 14px ${fonts.body};
    color: ${colors.textSecondary};
    margin-top: ${spacing[2]};
  `,
};

// =============================================================================
// HELPER: CSS class generator
// =============================================================================

export function css(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings.reduce((acc, str, i) => acc + str + (values[i] ?? ''), '').trim();
}
