/**
 * ShareOut Design System - Base CSS
 * CSS custom properties and reset styles
 */

import { colors, fonts, spacing, radius, shadows, animation, layout } from './tokens';

// =============================================================================
// CSS CUSTOM PROPERTIES
// =============================================================================

export const cssVariables = `
:root {
  /* Colors - Primary */
  --color-primary: ${colors.primary};
  --color-primary-hover: ${colors.primaryHover};
  --color-primary-light: ${colors.primaryLight};
  --color-primary-glow: ${colors.primaryGlow};

  /* Colors - Background */
  --color-bg: ${colors.bg};
  --color-bg-elevated: ${colors.bgElevated};
  --color-surface: ${colors.surface};

  /* Colors - Text */
  --color-text: ${colors.text};
  --color-text-secondary: ${colors.textSecondary};
  --color-text-tertiary: ${colors.textTertiary};
  --color-text-inverse: ${colors.textInverse};

  /* Colors - Borders */
  --color-border: ${colors.border};
  --color-border-strong: ${colors.borderStrong};

  /* Colors - Feedback */
  --color-success: ${colors.success};
  --color-success-light: ${colors.successLight};
  --color-warning: ${colors.warning};
  --color-warning-light: ${colors.warningLight};
  --color-error: ${colors.error};
  --color-error-light: ${colors.errorLight};

  /* Typography */
  --font-display: ${fonts.display};
  --font-body: ${fonts.body};
  --font-mono: ${fonts.mono};

  /* Spacing */
  --space-1: ${spacing[1]};
  --space-2: ${spacing[2]};
  --space-3: ${spacing[3]};
  --space-4: ${spacing[4]};
  --space-5: ${spacing[5]};
  --space-6: ${spacing[6]};
  --space-8: ${spacing[8]};
  --space-10: ${spacing[10]};
  --space-12: ${spacing[12]};
  --space-16: ${spacing[16]};
  --space-24: ${spacing[24]};
  --space-32: ${spacing[32]};

  /* Border Radius */
  --radius-sm: ${radius.sm};
  --radius-md: ${radius.md};
  --radius-lg: ${radius.lg};
  --radius-xl: ${radius.xl};
  --radius-full: ${radius.full};

  /* Shadows */
  --shadow-sm: ${shadows.sm};
  --shadow-md: ${shadows.md};
  --shadow-lg: ${shadows.lg};
  --shadow-xl: ${shadows.xl};

  /* Animation */
  --duration-fast: ${animation.durationFast};
  --duration-normal: ${animation.durationNormal};
  --duration-slow: ${animation.durationSlow};
  --ease-out: ${animation.easeOut};
  --ease-in-out: ${animation.easeInOut};

  /* Layout */
  --touch-target: ${layout.touchTarget};
  --touch-target-min: ${layout.touchTargetMin};
  --topbar-height: ${layout.topbarHeight};
  --header-height: ${layout.headerHeight};
  --max-width: ${layout.maxWidth};
}
`;

// =============================================================================
// CSS RESET
// =============================================================================

export const cssReset = `
*, *::before, *::after {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}

body {
  font: 400 16px/1.6 var(--font-body);
  background: var(--color-bg);
  color: var(--color-text);
  min-height: 100vh;
}

img, picture, video, canvas, svg {
  display: block;
  max-width: 100%;
}

input, button, textarea, select {
  font: inherit;
}

a {
  color: inherit;
  text-decoration: none;
}

button {
  cursor: pointer;
  border: none;
  background: none;
}

ul, ol {
  list-style: none;
}

/* Typographic defaults (Design/visual/typography.md craft details) */
h1, h2, h3, h4 {
  text-wrap: balance;
}

p {
  text-wrap: pretty;
}

/* Aligned numerals for tables, metrics, prices */
.numeric, [data-numeric] {
  font-variant-numeric: tabular-nums;
}

/* Focus States */
:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

:focus:not(:focus-visible) {
  outline: none;
}

/* Reduced Motion */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
`;

// =============================================================================
// COMPLETE BASE STYLES
// =============================================================================

export const baseStyles = cssVariables + cssReset;
